<img src="assets/icon.svg" width="64" height="64" alt="">

# webmcp-sdk

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a web page expose functions ("tools") to AI agents running in the browser, through `document.modelContext`. **webmcp-sdk** gives you a typed, validated, contract-first way to define those tools, built on [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, Effect…). The API is inspired by [oRPC](https://orpc.dev) and [TanStack](https://tanstack.com).

> [!WARNING]
> **Design prototype: types only, nothing runs.** Every runtime function throws `NotImplementedError` (only the error classes have real constructors), and nothing is published to npm. This repo is for reviewing the API before it is built.
> WebMCP is itself an **experimental** W3C Community Group draft (see [Platform status](#platform-status)).

## Quick start

```ts
import { z } from "zod";
import { tool, toolset } from "webmcp-sdk";

const todos: string[] = [];

const addTodo = tool({
  name: "add_todo",
  title: "Add todo",
  description: "Add an item to the user's todo list. Returns the new item count.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ count: z.number() }),
}).handler(({ input }) => {
  todos.push(input.text); // input.text: string, already validated
  return { count: todos.length }; // checked against `output` at compile time and runtime
});

const registration = await toolset([addTodo]).register();
// ...later
registration.unregister();
```

- **Arguments are validated** before your handler runs. The browser does not validate them. Invalid arguments go back to the agent as an actionable [`input_invalid`](#errors-agents-can-act-on) failure, with paths.
- **The agent sees a JSON Schema** generated from the same schema.
- **It is safe where WebMCP does not exist** (SSR, most browsers today): `register()` resolves with `state: "unsupported"` and registers nothing.

### The model

```ts nocheck
contract({...})  ──►  implement(contract).handler(fn)  ──►  toolset([...])  ──►  .register()
   what                  how                                 which, together       where, when
```

`tool({...})` is shorthand for `implement(contract({...}))`. Start with `tool`, then split out the contract when something else needs it.

**Contents:**
[Contract first](#contract-first) ·
[Toolsets](#toolsets) ·
[Context](#context) ·
[Schemas](#schemas-validation-vs-json-schema) ·
[Errors](#errors-agents-can-act-on) ·
[Lifetime and dynamic tools](#register-unregister-and-dynamic-tools) ·
[React](#react) ·
[Consumer](#consumer-discovering-and-calling-tools-optional) ·
[Testing](#testing) ·
[Limitations](#limitations-and-non-goals) ·
[Open questions](#open-questions) ·
[Status](#implementation-status)

Design rationale and rejected alternatives are in [`docs/design.md`](docs/design.md). Dated platform research is in [`docs/research.md`](docs/research.md).

---

## Contract first

A contract is **what** a tool is: name, metadata, schemas. It has no code and no browser dependency, so tests, a typed in-page agent, or a shared package can import it.

```ts file=contracts.ts
// contracts.ts
import { z } from "zod";
import { contract } from "webmcp-sdk";

export const addToCart = contract({
  name: "add_to_cart",
  title: "Add to cart",
  description: "Add a product to the shopping cart by SKU. Returns the new item count.",
  input: z.object({
    sku: z.string().regex(/^[A-Z0-9-]+$/),
    quantity: z.number().int().min(1).default(1),
  }),
  output: z.object({ itemCount: z.number().int() }),
});
```

```ts
// tools.ts
import { implement } from "webmcp-sdk";
import { addToCart } from "./contracts.js";
declare const api: { addToCart(sku: string, qty: number): Promise<{ items: unknown[] }> };

export const addToCartTool = implement(addToCart).handler(async ({ input, signal }) => {
  //                                                               input: { sku: string; quantity: number }
  const cart = await api.addToCart(input.sku, input.quantity);
  return { itemCount: cart.items.length };
});
```

The handler receives `{ input, context, signal }`. `signal` aborts when the browser cancels the call or when you unregister.

---

## Toolsets

A toolset is a group of tools registered and unregistered **together, all or nothing**. Names must be unique, and the compiler checks literal names:

```ts
import { tool, toolset } from "webmcp-sdk";

const listProducts = tool({
  name: "list_products",
  description: "List products in the catalog.",
  annotations: { readOnlyHint: true },
}).handler(() => [{ sku: "TEE-1", title: "T-shirt" }]);

const openProduct = tool({ name: "open_product", description: "Open a product page by SKU." })
  .handler(() => null);

export const catalogTools = toolset([listProducts, openProduct]);

const twin = tool({ name: "list_products", description: "Duplicate." }).handler(() => []);
// @ts-expect-error Potential duplicate tool name "list_products" in toolset
toolset([listProducts, twin]);
```

`annotations` are the WebMCP hints: `readOnlyHint`, `consequentialHint`, `untrustedContentHint`, `debugging`. They differ from MCP's set.

---

## Context

Handlers can simply close over module state. Use **context** when the same tools must run against **different instances**: one per widget, per React subtree, or a fake one in tests.

`$context<T>()` is **type-only**. It declares what the handler needs, and `register()` must then supply it.

```ts
import { tool, toolset } from "webmcp-sdk";

interface CartStore { list(): { sku: string; qty: number }[] }

const viewCart = tool({ name: "view_cart", description: "List cart items." })
  .$context<{ cart: CartStore }>()
  .handler(({ context }) => context.cart.list());

const whoAmI = tool({ name: "who_am_i", description: "The signed-in user's display name." })
  .$context<{ user: { name: string } }>()
  .handler(({ context }) => context.user.name);

const shopTools = toolset([viewCart, whoAmI]);

declare const cart: CartStore;
declare const session: { user: { name: string } };

// Required type: { cart: CartStore } & { user: { name: string } }.
// The getter runs on every call, so handlers never see stale values.
await shopTools.register({ context: () => ({ cart, user: session.user }) });

// @ts-expect-error context is required because tools declared one
await shopTools.register();
```

---

## Schemas: validation vs JSON Schema

A tool needs two separate things from a schema:

| capability | used for | standard |
| ---------- | -------- | -------- |
| **validate** | checking agent input, and your output, at runtime | `StandardSchemaV1` (`~standard.validate`) |
| **JSON Schema export** | telling the agent what to send | `StandardJSONSchemaV1` (`~standard.jsonSchema`) |

Validation does **not** imply export, so the SDK requires **both, at compile time**:

| library | how |
| ------- | --- |
| Zod ≥ 4.2, ArkType ≥ 2.1 | native: pass the schema |
| Valibot | `toStandardJsonSchema(schema)` from `@valibot/to-json-schema` |
| Effect 4 | `Schema.toStandardJSONSchemaV1(schema)` |
| anything else / hand-written JSON Schema | `withJsonSchema(schema, { input, output? })` |

```ts
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import { contract, withJsonSchema, type StandardSchemaV1 } from "webmcp-sdk";

contract({
  name: "search",
  description: "Search the catalog.",
  input: toStandardJsonSchema(v.object({ query: v.pipe(v.string(), v.minLength(1)) })),
});

contract({ name: "lookup", description: "Find by id.", input: type({ id: "string" }) });

declare const legacy: StandardSchemaV1<{ q: string }>; // validates, cannot describe itself
contract({
  name: "legacy_search",
  description: "Search (legacy validator).",
  input: withJsonSchema(legacy, {
    input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  }),
});

contract({
  name: "nope",
  description: "x",
  // @ts-expect-error Property 'jsonSchema' is missing: validation-only schema
  input: v.object({ query: v.string() }),
});
```

`withJsonSchema` is a promise *you* make. The SDK does not check that the JSON Schema matches the validator.

The input schema must describe an **object**. `z.string()`, arrays, `z.any()` and `z.never()` are compile errors.

### Input side vs output side

Schemas with transforms or defaults have two types, and the SDK uses the right side of each:

```ts
import { z } from "zod";
import { implement, contract, type InferToolInput, type InferToolOutput } from "webmcp-sdk";

const schedule = contract({
  name: "schedule_meeting",
  description: "Schedule a meeting. `start` is an ISO 8601 date-time.",
  input: z.object({
    start: z.iso.datetime(),               // agent sends a string
    minutes: z.number().int().default(30), // optional for the agent
  }),
  output: z.object({
    id: z.string(),
    start: z.date().transform((d) => d.toISOString()), // handler returns a Date, agent gets a string
  }),
});

type AgentSends = InferToolInput<typeof schedule>; // { start: string; minutes?: number | undefined }
type AgentGets = InferToolOutput<typeof schedule>; // { id: string; start: string }

implement(schedule).handler(({ input }) => {
  input.minutes; // number: defaults applied
  return { id: "m_1", start: new Date(input.start) };
});
```

| | advertised to the agent (JSON Schema) | seen by your handler |
| - | ------------------------------------- | -------------------- |
| `input` schema | **input** side | receives the **output** side |
| `output` schema | **output** side | returns the **input** side |

Without an `output` schema, a handler may return any `JsonValue` (or nothing, which is sent as `null`). `Date`, `bigint` and functions are compile errors. Declare an `output` schema to send richer types through a transform.

### Async validation and refinements

`validate` may return a promise, and the SDK always awaits it. Refinements are **not** visible in JSON Schema, so state the rule in the description too:

```ts
import { z } from "zod";
import { tool } from "webmcp-sdk";
declare function skuExists(sku: string): Promise<boolean>;

tool({
  name: "reorder",
  description: "Reorder a product. The SKU must exist (see list_products).",
  input: z.object({ sku: z.string() }).refine(async ({ sku }) => skuExists(sku), {
    message: "Unknown SKU. Call list_products to find valid SKUs.",
    path: ["sku"],
  }),
}).handler(({ input }) => ({ reordered: input.sku }));
```

### Schemas that cannot become JSON Schema

The types only say a library *can* convert. A given schema can still fail, for example Zod `z.date()` on the advertised side. Conversion runs in `register()`, and a failure rejects with `WebMCPError("json_schema_unavailable")` **before anything is registered**. You can catch it in CI with [`contract.toJSONSchema()`](#testing). The fix is always explicit: change the wire type (`z.iso.datetime()`) or use `withJsonSchema`. The SDK never silently weakens a schema to `{}`.

---

## Errors agents can act on

Throw `ToolError` for failures the agent should understand. Anything else stays private.

```ts
import { z } from "zod";
import { tool, ToolError } from "webmcp-sdk";
declare const stock: { available(sku: string): Promise<number> };

tool({
  name: "reserve_item",
  description: "Reserve units of a product by SKU.",
  input: z.object({ sku: z.string(), quantity: z.number().int().min(1) }),
}).handler(async ({ input }) => {
  const available = await stock.available(input.sku);
  if (available < input.quantity) {
    throw new ToolError(`Only ${available} left. Retry with quantity <= ${available}.`, {
      code: "OUT_OF_STOCK",
      data: { available },
    });
  }
  return { reserved: input.quantity };
});
```

What the agent receives at each boundary:

| `error.kind` | agent sees | when | agent should |
| ------------ | ---------- | ---- | ------------ |
| `input_invalid` | message + `issues: [{ path: "/quantity", message }]` | arguments fail the input schema | fix the arguments and retry |
| `execution_failed` | your `ToolError` message, `code`, `retryable`, `data` | the handler threw a `ToolError` | follow the message |
| `execution_failed` | `"The tool failed unexpectedly."`, `code: "internal"` | the handler threw anything else (the original goes to `onToolError` only) | not retry blindly |
| `execution_failed` | `code: "context_unavailable"` | your `context()` getter threw | not retry blindly |
| `output_invalid` | generic message | your return value fails the output schema (a page bug) | not retry |
| `cancelled` | message | the browser aborted the call (page unload…) and the handler stopped | stop |
| `unavailable` | message | you unregistered during the call and the handler did not complete | re-discover tools |

Stacks, `cause` chains, and non-`ToolError` messages are never sent.

**Failures are delivered in-band.** In the WebMCP draft, a rejected `execute` reaches the caller as an opaque `OperationError`, and the message is dropped. The SDK therefore *returns* failures:

```json
{ "isError": true, "error": { "kind": "execution_failed", "code": "OUT_OF_STOCK", "message": "Only 2 left. Retry with quantity <= 2.", "retryable": false, "data": { "available": 2 } } }
```

To keep strict agents from dropping this as malformed output, a tool with an `output` schema advertises `outputSchema: { anyOf: [<your output>, <failure envelope>] }`. See [Open questions](#open-questions) #1.

Developer mistakes are separate. They throw **`WebMCPError`** into *your* code, with `code` set to `unsupported`, `duplicate_name`, `json_schema_unavailable`, `invalid_definition` or `registration_failed`, and they never reach agents.

---

## Register, unregister, and dynamic tools

```ts
import { tool, toolset, WebMCPError } from "webmcp-sdk";

const tools = toolset([tool({ name: "ping", description: "Ping." }).handler(() => "pong")]);

// Handle: explicit, idempotent unregister
const reg = await tools.register();
if (reg.state === "unsupported") {
  /* no WebMCP here: nothing registered, nothing thrown */
}
reg.unregister();

// Signal: idiomatic DOM lifetime; it also cancels a registration still pending
const controller = new AbortController();
void tools.register({ signal: controller.signal });
controller.abort();

// Registration errors carry a code
try {
  await tools.register({ ifUnsupported: "throw" });
} catch (e) {
  if (e instanceof WebMCPError && e.code === "duplicate_name") console.warn(`${e.toolName} is taken`);
}
```

Guarantees:

- **All or nothing.** All JSON Schemas are resolved first. If the browser rejects any tool, the ones it already accepted are removed.
- **Ordered per name.** A registration waits until any previous SDK registration of the same name on the same model context has settled. That makes unregister-then-register deterministic (hot reload, StrictMode). Names owned by other code are never taken over.
- **Unregister ≠ kill.** WebMCP does not stop running callbacks when a tool is removed. The SDK aborts the handler's `signal`, but cancellation is cooperative. A handler that finishes anyway returns its real result.

**Dynamic tools.** Toolsets are immutable, so model tools that come and go as separate registrations. A signal makes this race-free, because aborting also cancels a pending registration:

```ts
import { tool, toolset } from "webmcp-sdk";

const checkoutTools = toolset([
  tool({ name: "checkout", description: "Start checkout.", annotations: { consequentialHint: true } })
    .handler(() => ({ redirect: "/checkout" })),
]);

let checkout: AbortController | undefined;
function onCartChange(itemCount: number) {
  if (itemCount > 0 && !checkout) {
    checkout = new AbortController();
    void checkoutTools.register({ signal: checkout.signal });
  } else if (itemCount === 0 && checkout) {
    checkout.abort();
    checkout = undefined;
  }
}
```

---

## React

`webmcp-sdk/react` is optional, and the core never imports React. Registration happens in effects, so nothing runs during SSR.

```tsx
import { useState } from "react";
import { z } from "zod";
import { contract, tool, toolset } from "webmcp-sdk";
import { RegisterToolset, useTool, useToolset } from "webmcp-sdk/react";

interface Cart { items: string[] }

// Module scope: stable identities
const cartTools = toolset([
  tool({ name: "view_cart", description: "List cart items." })
    .$context<{ cart: Cart }>()
    .handler(({ context }) => context.cart.items),
]);
const checkoutTools = toolset([tool({ name: "checkout", description: "Go to checkout." }).handler(() => "ok")]);
const addNote = contract({
  name: "add_note",
  description: "Add a note.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ count: z.number() }),
});

export function Shop({ cart }: { cart: Cart }) {
  // Changing `context` never re-registers. Handlers read the latest value on each call.
  const { state, error } = useToolset(cartTools, { context: { cart } });

  // Handler defined inside the component: it sees current state, and redefining it never re-registers.
  const [notes, setNotes] = useState<string[]>([]);
  useTool(addNote, ({ input }) => {
    setNotes((n) => [...n, input.text]);
    return { count: notes.length + 1 };
  });

  return (
    <>
      {state === "error" && <p>Tools unavailable: {error.code}</p>}
      {/* registered while mounted */}
      {cart.items.length > 0 && <RegisterToolset toolset={checkoutTools} />}
    </>
  );
}
```

Lifecycle (full contract in [`src/react/index.ts`](src/react/index.ts)):

| concern | behaviour |
| ------- | --------- |
| SSR / first render | `state: "idle"`; no `document` access |
| mount / unmount | register in an effect; abort that effect's own signal in cleanup |
| StrictMode double mount | register(A) → abort(A) → register(B); the per-name queue prevents a spurious `duplicate_name` |
| re-registers when | the **list of tools** changes (shallow), or `contract`, `enabled`, `modelContext`, `exposedTo`, `ifUnsupported`, `jsonSchemaTarget` change |
| never re-registers on | `context`, `handler`, `onToolError`: read from a ref on each call, so no stale closures |
| inline contracts/tools | re-register every render; logs a dev warning. Keep them at module scope |
| `<Activity mode="hidden">` | effects unmount, so tools are unregistered while hidden |
| unsupported browser | `state: "unsupported"` (not an error) |
| name already taken | `state: "error"`, `duplicate_name`; never replaces the other tool; retried automatically when that registration ends |
| errors | never thrown during render; reported via `state`/`error` and `onRegistrationError` |

---

## Consumer: discovering and calling tools (optional)

`webmcp-sdk/consumer` is for **in-page agents**, such as a chat widget or copilot running *inside* the page that wants the page's tools and those of its frames. It wraps the draft's `getTools()`, `executeTool()` and `toolchange` (**EXPERIMENTAL**). It is a separate entry point, and the core does not depend on it.

### Plug the list into any agent framework

```ts
import { createToolCatalog } from "webmcp-sdk/consumer";

declare const agent: { setTools(tools: unknown[]): void }; // any framework

const catalog = createToolCatalog();

catalog.subscribe(({ tools }) => {
  agent.setTools(
    tools.map((t) => ({
      name: t.uniqueName,          // unique in this snapshot, even across frames
      description: t.description,
      parameters: t.inputSchema,   // JSON Schema, as published by the tool's page
      execute: async (args: unknown) => {
        const result = await t.call(args);
        return result.ok ? result.value : { error: result.error };
      },
    })),
  );
});
```

`subscribe`/`getSnapshot` follow the React external-store contract, so they plug straight into `useSyncExternalStore`. Other frameworks need a one-line adapter, because `subscribe` does not emit immediately. Svelte, for example: `readable(catalog.getSnapshot(), (set) => catalog.subscribe(set))`.

```tsx
import { useSyncExternalStore } from "react";
import { createToolCatalog } from "webmcp-sdk/consumer";

const catalog = createToolCatalog();
export function ToolList() {
  const { tools } = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  return <ul>{tools.map((t) => <li key={t.id}>{t.title ?? t.name} <small>{t.source.origin}</small></li>)}</ul>;
}
```

### Identity, collisions, and stale ids

| | what | unique within | stable |
| - | ---- | ------------- | ------ |
| `name` | the provider's name | one document | as long as the provider keeps it |
| `title` | display label | nothing | no |
| `uniqueName` | name for the LLM: `name`, or `name__f1` on collision | one snapshot | until collisions change |
| `id` | observed source + name + descriptor fingerprint | the catalog | never reassigned to another tool |

The guarantees come in three levels, and only the first is a promise:

1. **The SDK never remaps an id.** If the latest snapshot no longer has that exact source, name and descriptor (unregistered, schema or description changed, source gone), `call` returns `{ kind: "stale" }` **without calling the browser**.
2. **Change detection is best-effort.** A same-origin frame that navigates is detected. A cross-origin frame is opaque: if it navigates to a page with identical tools, the SDK cannot see it. An identical descriptor re-registered under the same name keeps its id, because the platform exposes no registration instance id.
3. **There is no atomic check-and-call.** `executeTool` resolves by name in the owner document. A change the catalog has not yet observed can slip in between the check and the call. The browser still enforces origin and exposure.

Two frames exposing `search` get `search__self` and `search__f1`, and each call goes to its own document. Discovered tools are **unknown at compile time**: inputs and results are `unknown`. Never persist ids.

```ts
import { createToolCatalog } from "webmcp-sdk/consumer";

const catalog = createToolCatalog();
const snapshot = await catalog.refresh();
const search = snapshot.get("search");
if (search) {
  const r = await search.call({ q: "red shoes" });
  if (!r.ok && r.error.kind === "stale") await catalog.refresh(); // re-plan with the new tool list
}
```

### Known tools: typed by contract, checked at runtime

When you *know* a tool's contract, `bindContract` gives static types. Discovery cannot prove them, so the SDK validates input before sending and output on return:

```ts
import { z } from "zod";
import { contract } from "webmcp-sdk";
import { createToolCatalog } from "webmcp-sdk/consumer";

const searchContract = contract({
  name: "search",
  description: "Search products.",
  input: z.object({ q: z.string() }),
  output: z.object({ hits: z.array(z.object({ sku: z.string(), title: z.string() })) }),
});

const catalog = createToolCatalog();
const search = catalog.bindContract(searchContract, {
  pick: (candidates) => candidates.find((t) => t.source.isSelf), // several frames? choose explicitly
});

const r = await search.call({ q: "red shoes" });
if (r.ok) r.value.hits[0]?.sku; // typed
else if (r.error.kind === "output_invalid") {
  /* a tool by that name exists but does not honour the contract */
}
```

`bindContract` resolves by **name at call time**. That is an explicit "whichever tool implements this contract" binding, unlike an id. Ambiguity without `pick` returns `unresolved` and nothing runs.

**Security.** The catalog sees only what `getTools()` returns. Cross-origin tools appear only when the owner registered with `exposedTo` **and** you pass `fromOrigins`. The browser and permissions policy remain the only authority.

---

## Testing

Contracts are plain values, so most tests need no browser:

```ts
import { z } from "zod";
import { contract } from "webmcp-sdk";

const c = contract({
  name: "remind_me",
  description: "Set a reminder.",
  input: z.object({ when: z.date() }), // not representable in JSON Schema
});

// In a unit test: fail in CI, not at registration in production.
const { input } = c.toJSONSchema();
if (!input.ok) throw new Error(`${input.side} schema: ${input.message}`);
```

For registration tests, pass any object with a `registerTool` method as `modelContext`, or install [`@w3c/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill).

---

## Limitations and non-goals

- **No runtime yet.** This repo is a design review artifact.
- **Types are compile-time only.** They describe *validated* values. Runtime truth comes from Standard Schema validation on every call: input always, output when an `output` schema is set.
- **JSON Schema is only as good as your library's converter.** Refinements and transforms are not expressible, so say them in `description`.
- **No MCP envelope.** WebMCP returns plain JSON, so MCP's `CallToolResult`/`structuredContent` do not apply.
- **No security layer.** Tools are same-origin by default. Cross-origin access goes only through the platform's `exposedTo`, `fromOrigins` and permissions policy.
- **Out of scope for v0:** declarative (HTML form) tools, workers, middleware, MCP transports. See `@modelcontextprotocol/sdk` or MCP-B for bridges.

## Open questions

These are the decisions that would change the product. Recommendations are in [`docs/design.md`](docs/design.md#recommendations-on-open-questions).

1. **Failure envelope vs `outputSchema`.** Advertising `anyOf [output, envelope]` keeps strict agents happy but makes the schema noisier. The alternative is to omit `outputSchema` whenever failures are possible. This needs input from agent implementers.
2. **Typed error maps in contracts** (oRPC `.errors({...})`). Today errors use an untyped `ToolError(code)`. Typed maps can be added later without breaking anything.
3. **Toolset name prefixes** (`toolset(tools, { prefix: "cart." })`) for widgets mounted twice. Not included.
4. **Consumer packaging.** Ship `/consumer` in this package or separately? The draft's `getTools()` frame traversal is still unsettled (its prose and algorithm disagree).

## Implementation status

| export | status |
| ------ | ------ |
| `contract`, `implement`, `tool`, `toolset`, `.register()`, `withJsonSchema`, `contract.toJSONSchema()` | types for review · runtime throws `NotImplementedError` |
| `ToolError`, `WebMCPError`, `NotImplementedError` | plain classes (implemented) |
| `getModelContext()` | types · runtime throws |
| `webmcp-sdk/react`: `useToolset`, `useTool`, `RegisterToolset` | types · runtime throws |
| `webmcp-sdk/consumer`: `createToolCatalog`, `bindContract` | types · runtime throws |

`pnpm check` typechecks the sources, the [type tests](type-tests/) (positive and `@ts-expect-error` negative cases), and every TypeScript block in this README and `docs/design.md` not marked `nocheck`. No license has been chosen yet.

## Platform status

As of 2026-11-06 (details, quotes and links in [`docs/research.md`](docs/research.md)):

- **Spec:** [WebMCP Draft CG Report, 2 Nov 2026](https://webmachinelearning.github.io/webmcp/). EXPERIMENTAL, not on the W3C standards track.
  - Entry point `document.modelContext` (secure contexts only). `navigator.modelContext` is a deprecated Chromium name.
  - `registerTool(tool, { signal, exposedTo })` returns `Promise<undefined>`. Removal is by aborting `signal`.
  - Consumer side: `getTools()`, `executeTool()`, the `toolchange` event.
- **Chrome:** origin trial from Chrome 149, plus `chrome://flags/#enable-webmcp-testing`. Chrome Status metadata is inconsistent, so do not assume general availability.
- **Other engines:** no confirmed shipping implementation.
- **Polyfill:** official [`@w3c/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill) 0.1.0. `@mcp-b/*` packages are community projects.

## Sources

All accessed 2026-11-06:

- WebMCP draft <https://webmachinelearning.github.io/webmcp/> · source pinned at [`6cd745a`](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs)
- Chrome WebMCP <https://developer.chrome.com/docs/ai/webmcp> · Chrome Status <https://chromestatus.com/feature/5117755740913664>
- Official polyfill <https://github.com/webmachinelearning/webmcp-polyfill>
- Standard Schema / Standard JSON Schema <https://standardschema.dev> · `@standard-schema/spec@1.1.0`
- Zod <https://zod.dev/json-schema> · Valibot <https://valibot.dev/guides/json-schema/> · ArkType <https://arktype.io/docs/configuration>
- oRPC contract-first (v1) <https://v1.orpc.dev/docs/contract-first/implement-contract>
- TanStack Query options <https://tanstack.com/query/latest/docs/framework/react/guides/query-options>
- MCP tools (2026-07-28) <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

## Development

```sh
pnpm install
pnpm check   # sources + type tests + README/docs code blocks
```
