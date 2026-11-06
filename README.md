<img src="assets/icon.svg" width="64" height="64" alt="">

# webmcp-sdk

**Contract-first, type-safe [WebMCP](https://webmachinelearning.github.io/webmcp/) tools for TypeScript, built on [Standard Schema](https://standardschema.dev).**
The API is inspired by [oRPC](https://orpc.dev)'s contract-first flow and by [TanStack](https://tanstack.com)'s framework-agnostic core with thin adapters.

> [!WARNING]
> **Design prototype. Nothing here runs yet.**
> This repository contains the complete **typed API surface**, signatures, type-level tests and this README. Every runtime function throws `NotImplementedError`. The one exception is `getModelContext()`, a feature-detection helper. Nothing is published to npm.
> The goal is to review the developer experience before writing the implementation.
>
> WebMCP itself is an **experimental W3C Community Group draft** (2 November 2026), not a W3C standard. Browser support is partial and behind flags or origin trials. See [Platform status](#platform-status).

```ts nocheck
contract  ──►  implement(contract).handler(fn)  ──►  toolset([...])  ──►  .register()
(what)         (how)                                (which, together)     (where, when)
```

- **Contract**: name, title, description, input/output schemas. No code and no browser dependency. Shareable.
- **Implementation**: one contract plus one handler, with fully inferred types.
- **Toolset**: tools that are registered and unregistered together, all or nothing.
- **Registration**: a toolset is live in one document until you unregister it or abort its signal.

**Contents**

1. [Quick start](#quick-start)
2. [Contract first](#contract-first)
3. [Several tools, one toolset, shared context](#several-tools-one-toolset-shared-context)
4. [Schemas: validation vs JSON Schema](#schemas-validation-vs-json-schema)
5. [Errors agents can act on](#errors-agents-can-act-on)
6. [Register, unregister, and dynamic tools](#register-unregister-and-dynamic-tools)
7. [React](#react)
8. [Consumer: discovering and calling tools](#consumer-discovering-and-calling-tools-optional)
9. [Testing](#testing)
10. [Limitations and non-goals](#limitations-and-non-goals)
11. [Open questions](#open-questions)
12. [Implementation status](#implementation-status)
13. [Platform status](#platform-status) and [sources](#sources)

Design rationale and rejected alternatives are in [`docs/design.md`](docs/design.md). Dated research notes are in [`docs/research.md`](docs/research.md).

---

## Quick start

```ts
import { z } from "zod";
import { tool, toolset } from "webmcp-sdk";

const getWeather = tool({
  name: "get_weather",
  title: "Get weather",
  description: "Current weather for a city. Use metric units.",
  input: z.object({ city: z.string().min(1) }),
  output: z.object({ tempC: z.number(), summary: z.string() }),
}).handler(async ({ input, signal }) => {
  const res = await fetch(`/api/weather?city=${encodeURIComponent(input.city)}`, { signal });
  return (await res.json()) as { tempC: number; summary: string };
});

const registration = await toolset([getWeather]).register();
// ...later
registration.unregister();
```

You get all of this from that snippet:

- `input.city` is a `string` inferred from the schema. The return type is checked against `output`.
- Arguments from the agent are **validated** before your handler runs. Bad arguments come back to the agent as an [`input_invalid`](#errors-agents-can-act-on) failure with paths.
- The agent sees a JSON Schema generated from the same Zod schema.
- `signal` aborts when the agent cancels or when you unregister.

---

## Contract first

Split **what** a tool is from **how** it works when more than one place needs to know about it: tests, a typed in-page agent, documentation, a shared package.

```ts file=contracts.ts
// contracts.ts — no implementation, no browser APIs
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
  annotations: { consequentialHint: false },
});
```

```ts
// tools.ts — implementation, types come from the contract
import { implement } from "webmcp-sdk";
import { addToCart } from "./contracts.js";
declare const api: { addToCart(sku: string, qty: number): Promise<{ items: unknown[] }> };

export const addToCartTool = implement(addToCart).handler(async ({ input }) => {
  //                                                          ^? { sku: string; quantity: number }
  const cart = await api.addToCart(input.sku, input.quantity);
  return { itemCount: cart.items.length };
});
```

`tool({...})` is exactly `implement(contract({...}))`. Start inline and extract the contract when you need it.

---

## Several tools, one toolset, shared context

Handlers can close over module state. When the same tools must work against **different instances** (one per widget, per tenant, or per React subtree), declare a **context** instead. `$context<T>()` is type-only, and the value is supplied at registration.

```ts
import { z } from "zod";
import { contract, implement, tool, toolset } from "webmcp-sdk";

interface CartStore {
  add(sku: string, qty: number): number;
  list(): { sku: string; qty: number }[];
}

const viewCart = tool({
  name: "view_cart",
  description: "List cart items.",
  annotations: { readOnlyHint: true },
})
  .$context<{ cart: CartStore }>()
  .handler(({ context }) => context.cart.list());

const addToCart = implement(
  contract({
    name: "add_to_cart",
    description: "Add a product by SKU.",
    input: z.object({ sku: z.string(), quantity: z.number().int().min(1) }),
    output: z.object({ itemCount: z.number() }),
  }),
)
  .$context<{ cart: CartStore }>()
  .handler(({ input, context }) => ({ itemCount: context.cart.add(input.sku, input.quantity) }));

const whoAmI = tool({ name: "who_am_i", description: "The signed-in user's display name." })
  .$context<{ user: { name: string } }>()
  .handler(({ context }) => context.user.name);

export const shopTools = toolset([viewCart, addToCart, whoAmI]);

declare const cart: CartStore;
declare const session: { user: { name: string } };

// Context is the intersection of what every tool declared: { cart: CartStore; user: { name: string } }.
// It is resolved on each call, so handlers never see stale values.
const registration = await shopTools.register({
  context: () => ({ cart, user: session.user }),
});
```

What the compiler enforces:

```ts
import { tool, toolset } from "webmcp-sdk";

const a = tool({ name: "ping", description: "Ping." }).handler(() => "pong");
const b = tool({ name: "ping", description: "Another ping." }).handler(() => "pong");
// @ts-expect-error Duplicate tool name "ping" in toolset
toolset([a, b]);

const needsCart = tool({ name: "cart", description: "Cart." })
  .$context<{ cart: string[] }>()
  .handler(({ context }) => context.cart);
// @ts-expect-error context is required because a tool declared one
await toolset([needsCart]).register();
```

---

## Schemas: validation vs JSON Schema

A WebMCP tool needs two separate things from a schema:

| capability            | used for                                  | standard                                      |
| --------------------- | ----------------------------------------- | --------------------------------------------- |
| **validate**          | checking agent input and your output at runtime | `StandardSchemaV1` (`~standard.validate`) |
| **JSON Schema export** | telling the agent what to send            | `StandardJSONSchemaV1` (`~standard.jsonSchema`) |

Validation does **not** imply JSON Schema export. The SDK therefore requires **both, at compile time** (the `ToolSchema` type):

| library | how |
| ------- | --- |
| Zod ≥ 4.2 | native: pass the schema |
| ArkType ≥ 2.1 | native: pass the type |
| Valibot | `toStandardJsonSchema(schema)` from `@valibot/to-json-schema` |
| Effect 4 | `Schema.toStandardJSONSchemaV1(schema)` |
| anything else, or hand-written JSON Schema | `withJsonSchema(schema, { input, output? })` |

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

### Input side vs output side

Schemas with transforms or defaults have two types. The SDK always uses the right side:

```ts
import { z } from "zod";
import { implement, contract, type InferToolInput, type InferToolOutput } from "webmcp-sdk";

const schedule = contract({
  name: "schedule_meeting",
  description: "Schedule a meeting. `start` is an ISO 8601 date-time.",
  input: z.object({
    start: z.iso.datetime(),            // agent sends a string...
    minutes: z.number().int().default(30),
  }),
  output: z.object({
    id: z.string(),
    start: z.date().transform((d) => d.toISOString()), // ...handler returns a Date, agent receives a string
  }),
});

type AgentSends = InferToolInput<typeof schedule>;     // { start: string; minutes?: number | undefined }
type AgentGets = InferToolOutput<typeof schedule>;     // { id: string; start: string }

implement(schedule).handler(({ input }) => {
  input.minutes; // number: defaults already applied
  return { id: "m_1", start: new Date(input.start) };
});
```

|                | agent ↔ JSON Schema         | handler (TypeScript)       |
| -------------- | --------------------------- | -------------------------- |
| `input` schema | **input** side is advertised | receives the **output** side |
| `output` schema | **output** side is advertised | returns the **input** side  |

### Async validation and refinements

`~standard.validate` may return a promise. The SDK always awaits it, so async refinements work. Refinements are **not** visible in JSON Schema, so state the rule in the description.

```ts
import { z } from "zod";
import { tool } from "webmcp-sdk";
declare function skuExists(sku: string): Promise<boolean>;

tool({
  name: "reorder",
  description: "Reorder a product. The SKU must exist in the catalog (see list_products).",
  input: z.object({ sku: z.string() }).refine(async ({ sku }) => skuExists(sku), {
    message: "Unknown SKU. Call list_products to find valid SKUs.",
    path: ["sku"],
  }),
}).handler(({ input }) => ({ ok: true, sku: input.sku }));
```

### Schemas that cannot become JSON Schema

The types say "this library *can* convert", but a specific schema can still fail at runtime, e.g. Zod `z.date()` or `z.bigint()` on the advertised side. Conversion runs when you call `register()`. A failure rejects with `WebMCPError("json_schema_unavailable")` **before anything is registered**. Catch it in CI with [`contract.toJSONSchema()`](#testing). The fix is always explicit: change the wire type (`z.iso.datetime()`), or describe it yourself with `withJsonSchema`. The SDK never silently weakens a schema to `{}`.

---

## Errors agents can act on

Throw `ToolError` for failures the agent should understand. Anything else stays private.

```ts
import { z } from "zod";
import { tool, ToolError } from "webmcp-sdk";
declare const stock: { available(sku: string): Promise<number> };

tool({
  name: "add_to_cart",
  description: "Add a product by SKU.",
  input: z.object({ sku: z.string(), quantity: z.number().int().min(1) }),
}).handler(async ({ input }) => {
  const available = await stock.available(input.sku);
  if (available < input.quantity) {
    throw new ToolError(`Only ${available} left. Retry with quantity <= ${available}.`, {
      code: "OUT_OF_STOCK",
      data: { available },
    });
  }
  return { added: input.quantity };
});
```

What the agent receives, per failure boundary:

| boundary | `error.kind` | agent sees | when |
| -------- | ------------ | ---------- | ---- |
| input | `input_invalid` | message + `issues: [{ path: "/quantity", message }]` | arguments fail the input schema (the browser does not validate them) |
| execution | `execution_failed` | your `ToolError` message, `code`, `retryable`, `data` | handler threw `ToolError` |
| execution | `execution_failed` | `"The tool failed unexpectedly."`, `code: "internal"` | handler threw anything else; the original goes to `onError` only |
| output | `output_invalid` | generic message (page bug, do not retry) | your return value fails the output schema |
| cancelled | `cancelled` | — | agent aborted, or you unregistered, and the handler stopped |
| unavailable | `unavailable` | — | the toolset was unregistered or `context()` cannot be resolved |

Stacks, `cause`, and non-`ToolError` messages are never serialized.

**Delivered in-band.** In the WebMCP draft, a rejected `execute` reaches the caller as an opaque `OperationError` and the message is dropped. A failure is therefore *returned* as JSON: `{ "error": { "kind": "...", "message": "..." } }` ([`ToolFailureResult`](src/errors.ts)). See [Open questions](#open-questions) for the trade-off.

Developer mistakes are a different thing. They throw `WebMCPError` into **your** code (`unsupported`, `duplicate_name`, `json_schema_unavailable`, `invalid_definition`, `registration_failed`) and never reach agents.

---

## Register, unregister, and dynamic tools

```ts
import { tool, toolset, WebMCPError } from "webmcp-sdk";

const tools = toolset([tool({ name: "ping", description: "Ping." }).handler(() => "pong")]);

// 1. Handle: explicit unregister (idempotent)
const reg = await tools.register();
reg.unregister();

// 2. Signal: idiomatic DOM lifetime. Also cancels a registration still pending.
const controller = new AbortController();
await tools.register({ signal: controller.signal });
controller.abort();

// 3. Progressive enhancement: no WebMCP → no error, state tells you
const maybe = await tools.register({ ifUnsupported: "skip" });
if (maybe.state === "unsupported") {
  /* hide your "AI-ready" badge */
}

// 4. Errors are WebMCPErrors with a code
try {
  await tools.register();
} catch (e) {
  if (e instanceof WebMCPError && e.code === "duplicate_name") {
    console.warn(`${e.toolName} is already registered by other code`);
  }
}
```

Guarantees:

- **All or nothing.** All JSON Schemas are resolved first. If the browser then rejects any tool, the ones it accepted are removed.
- **Ordered per name.** A registration of `ping` waits for a previous SDK registration of `ping` on the same model context to settle. Unregister-then-register (hot reload, StrictMode) is deterministic. Names owned by other code are never taken over.
- **Unregister ≠ kill.** Removing a tool in WebMCP does not stop running callbacks. The SDK aborts the handler's `signal`, but cancellation is cooperative. A handler that finishes anyway returns its real result, never a fake `cancelled`.

**Dynamic availability.** Toolsets are immutable. Model "tools that come and go" as separate toolsets with their own lifetimes, rather than by mutating one:

```ts
import { tool, toolset, type ToolsetRegistration } from "webmcp-sdk";

const checkoutTools = toolset([
  tool({ name: "checkout", description: "Start checkout.", annotations: { consequentialHint: true } })
    .handler(() => ({ redirect: "/checkout" })),
]);

let checkout: ToolsetRegistration | undefined;
async function onCartChange(itemCount: number) {
  if (itemCount > 0 && !checkout) checkout = await checkoutTools.register();
  if (itemCount === 0 && checkout) {
    checkout.unregister();
    checkout = undefined;
  }
}
```

(Real code needs to handle overlapping calls. The React bindings do it for you.)

---

## React

`webmcp-sdk/react` is optional. The core never imports React. These bindings register in effects, so nothing happens during SSR.

```tsx
import { useState } from "react";
import { z } from "zod";
import { contract, implement, toolset } from "webmcp-sdk";
import { useTool, useToolset, WebMCPTools } from "webmcp-sdk/react";

interface Cart { items: string[] }

// Module scope: stable identities.
const viewCart = implement(contract({ name: "view_cart", description: "List cart items." }))
  .$context<{ cart: Cart }>()
  .handler(({ context }) => context.cart.items);
const cartTools = toolset([viewCart]);

const checkoutTools = toolset([
  implement(contract({ name: "checkout", description: "Go to checkout." })).handler(() => "ok"),
]);

const addTodo = contract({
  name: "add_todo",
  description: "Add a todo item.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ count: z.number() }),
});

export function Shop({ cart }: { cart: Cart }) {
  // Context updates never re-register. Handlers read the latest value per call.
  const status = useToolset(cartTools, { context: { cart } });

  const [todos, setTodos] = useState<string[]>([]);
  // Handler defined in the component: it sees current state, and changing it never re-registers.
  useTool(addTodo, ({ input }) => {
    setTodos((t) => [...t, input.text]);
    return { count: todos.length + 1 };
  });

  return (
    <>
      {status.status === "error" && <p>Tools unavailable: {status.error.code}</p>}
      {/* Mounted ⇒ registered. Unmounted ⇒ unregistered. */}
      {cart.items.length > 0 && <WebMCPTools toolset={checkoutTools} />}
    </>
  );
}
```

Lifecycle rules (full text in [`src/react/index.ts`](src/react/index.ts)):

| concern | behaviour |
| ------- | --------- |
| SSR / first render | `status: "idle"`, nothing registered, no `document` access |
| mount / unmount | register in effect, abort in cleanup |
| StrictMode double mount | register(A) → abort(A) → register(B); the per-name queue prevents spurious `duplicate_name` |
| re-registers on | identity change of `toolset`/`contract`, `enabled`, `modelContext` |
| never re-registers on | `context`, `handler`, `onError`; read from a ref on each call (no stale closures) |
| unsupported browser | `status: "unsupported"`, not an error (default `ifUnsupported: "skip"`) |
| same name mounted twice | first wins; second gets `status: "error"`, `duplicate_name`. Never silently replaced |
| errors | never thrown during render; `status.error` + `onRegistrationError` |

Keep contracts and toolsets at **module scope** (or memoized). Defining them inline in a component creates a new identity on every render, and the tools re-register on every render.

---

## Consumer: discovering and calling tools (optional)

`webmcp-sdk/consumer` is for **in-page agents**: a chat widget or a copilot running *in* the page that wants the page's tools (and those of its frames). It wraps the draft's `getTools()`, `executeTool()` and `toolchange`. It is a separate entry point, and the core does not depend on it.

### Plug the list into any agent framework

```ts
import { createToolCatalog } from "webmcp-sdk/consumer";

declare const agent: { setTools(tools: unknown[]): void }; // any framework

const catalog = createToolCatalog();

catalog.subscribe(({ tools }) => {
  agent.setTools(
    tools.map((t) => ({
      name: t.key,                 // unique in this snapshot, even across frames
      description: t.description,
      parameters: t.inputSchema,   // JSON Schema, as provided by the tool's page
      execute: async (args: unknown) => {
        const result = await t.call(args);
        return result.ok ? result.value : { error: result.error };
      },
    })),
  );
});
```

`subscribe`/`getSnapshot` fit React's `useSyncExternalStore` directly:

```tsx
import { useSyncExternalStore } from "react";
import { createToolCatalog } from "webmcp-sdk/consumer";

const catalog = createToolCatalog();
export function ToolList() {
  const { tools } = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  return <ul>{tools.map((t) => <li key={t.ref}>{t.title ?? t.name} <small>{t.source.origin}</small></li>)}</ul>;
}
```

### Identity, collisions, and stale references

| | what | unique within | stable |
| - | ---- | ------------- | ------ |
| `name` | provider's name | one document | per document |
| `title` | display label | nothing | no |
| `key` | name to give the LLM: `name`, or `name__f2` on collision | one snapshot | until collisions change |
| `ref` | identity = source document + name + descriptor fingerprint | everything | never reused for another tool |

- Two frames both expose `search`. The keys become `search__self` and `search__f1`, and each call goes to its own document.
- The tool was unregistered, its schema or description changed, or its frame navigated or disappeared: calling the old ref returns `{ ok: false, error: { kind: "stale" } }`, and **nothing runs**. The SDK never reroutes an old ref to another tool.
- A tool re-registered with an *identical* descriptor keeps its ref. The platform exposes no instance id, so the SDK cannot tell them apart. Do not persist refs.
- A call that starts before a change and finishes after it settles normally. The browser decides (`AbortError` if the owner unloaded).
- Discovered tools are **unknown at compile time**: inputs are `unknown` and results are `unknown`.

```ts
import { createToolCatalog } from "webmcp-sdk/consumer";

const catalog = createToolCatalog();
const snapshot = await catalog.refresh();
const search = snapshot.get("search");
if (search) {
  const r = await catalog.call(search.ref, { q: "red shoes" });
  if (!r.ok && r.error.kind === "stale") await catalog.refresh(); // re-plan with new tools
}
```

### Known tools: typed by contract, checked at runtime

When you *know* a tool's contract, `bind` gives static types. Discovery cannot prove them, so the SDK validates input before sending and output on return:

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
const search = catalog.bind(searchContract, {
  pick: (candidates) => candidates.find((t) => t.source.isSelf), // several frames? choose explicitly
});

const r = await search.call({ q: "red shoes" });
if (r.ok) r.value.hits[0]?.sku; // typed
else if (r.error.kind === "output_invalid") {
  /* tool exists but does not honour the contract */
}
```

`bind` resolves by **name at call time**. That is an explicit "whoever implements this contract" binding, unlike a ref. Ambiguity without `pick` returns `unresolved`/`ambiguous` and nothing runs.

**Security.** The catalog only sees what `getTools()` returns. Cross-origin tools appear only when the owner registered with `exposedTo` **and** you pass `fromOrigins`. The browser and permissions policy remain the only authority. The SDK adds none.

---

## Testing

Contracts are plain values, so most tests need no browser:

```ts
import { z } from "zod";
import { contract } from "webmcp-sdk";

const c = contract({
  name: "x",
  description: "x",
  input: z.object({ when: z.date() }), // not representable in JSON Schema
});

// In a unit test: fails fast instead of at registration in production.
const { input } = c.toJSONSchema();
if (!input.ok) throw new Error(`${input.side} schema: ${input.message}`);
```

For registration tests, pass any object with a `registerTool` method as `modelContext` (or install `@w3c/webmcp-polyfill`).

---

## Limitations and non-goals

- **No runtime yet.** This is a design review artifact.
- **Static types are compile-time only.** They describe what a *validated* value looks like. Runtime truth comes from Standard Schema validation, which runs on every call (input always, output when an `output` schema is set).
- **The JSON Schema agents see is only as good as your library's converter.** Refinements, custom checks and transforms are not expressible, so say them in `description`.
- **Results must be JSON-serializable.** WebMCP serializes results with JSON. Use an output schema to make the wire format explicit.
- **No MCP content envelope.** WebMCP returns plain JSON. MCP's `CallToolResult`, `structuredContent` and `isError` do not apply here.
- **No security layer.** Same-origin by default. Cross-origin uses only the platform's `exposedTo` / `fromOrigins` / permissions policy.
- **No declarative (HTML form) tools.** The draft's declarative API is out of scope for v0.
- **Not a server MCP SDK.** No transports, prompts or resources (see `@modelcontextprotocol/sdk` or MCP-B for bridges).

## Open questions

These are the decisions most likely to change the product. Everything else has a recommended answer in [`docs/design.md`](docs/design.md).

1. **In-band failures vs `outputSchema`.** Returning `{ error }` keeps failures actionable, but it does not match `outputSchema`. Alternatives: advertise `outputSchema` as `oneOf [output, failure]`, omit `outputSchema` from descriptors, or offer `failures: "reject"` for spec purists. Current pick: in-band. This needs feedback from agent implementers.
2. **Typed error maps in contracts** (oRPC `.errors({...})`). Useful for typed consumers, but it adds weight to every contract. Current pick: untyped `ToolError(code)`. Could be added later without breaking changes.
3. **Toolset-level name prefixes** (`toolset(tools, { prefix: "cart." })`) for apps that mount the same widget twice. Not included.
4. **Output validation in production.** It is always on today. An opt-out (`validateOutput: false`) would trade safety for speed.
5. **Consumer layer scope.** Ship it inside this package (`webmcp-sdk/consumer`) or as its own package? And is the draft's `getTools()` frame traversal stable enough to build on? Its prose and algorithm currently disagree.
6. **License.** Not chosen yet.

## Implementation status

| export | status |
| ------ | ------ |
| `contract`, `implement`, `tool`, `toolset`, `.register()`, `withJsonSchema` | types final for review · runtime throws `NotImplementedError` |
| `ToolError`, `WebMCPError`, `NotImplementedError` | plain classes (implemented) |
| `getModelContext()` | implemented (feature detection only) |
| `webmcp-sdk/react`: `useToolset`, `useTool`, `WebMCPTools` | types · runtime throws |
| `webmcp-sdk/consumer`: `createToolCatalog`, `bind` | types · runtime throws |

Verified by `pnpm check`: the sources, the [type tests](type-tests/), and **every TypeScript block in this README and in `docs/`** typecheck.

## Platform status

As of 2026-11-06 (details and links in [`docs/research.md`](docs/research.md)):

- **Spec:** [WebMCP Draft CG Report, 2 Nov 2026](https://webmachinelearning.github.io/webmcp/). **EXPERIMENTAL**, not on the W3C standards track.
  - Entry point: `document.modelContext` (secure contexts). `navigator.modelContext` is a deprecated Chromium name.
  - `registerTool(tool, { signal, exposedTo })` returns `Promise<undefined>`; removal is by aborting `signal`. `unregisterTool`/`provideContext`/`clearContext` are gone.
  - Consumer side: `getTools()`, `executeTool()` and the `toolchange` event are in the draft.
- **Chrome:** origin trial from Chrome 149 and `chrome://flags/#enable-webmcp-testing`. Chrome Status metadata is internally inconsistent, so do not assume general availability.
- **Other engines:** no confirmed shipping implementation.
- **Polyfill:** official [`@w3c/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill) 0.1.0 (`installWebMCP()`). MCP-B's `@mcp-b/*` packages are community projects.

## Sources

Accessed 2026-11-06:

- WebMCP draft: <https://webmachinelearning.github.io/webmcp/> · source pinned at [`6cd745a`](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs)
- Chrome WebMCP docs: <https://developer.chrome.com/docs/ai/webmcp> · Chrome Status: <https://chromestatus.com/feature/5117755740913664>
- Official polyfill: <https://github.com/webmachinelearning/webmcp-polyfill>
- Standard Schema and Standard JSON Schema: <https://standardschema.dev> · `@standard-schema/spec@1.1.0`
- Zod JSON Schema: <https://zod.dev/json-schema> · Valibot: <https://valibot.dev/guides/json-schema/> · ArkType: <https://arktype.io/docs/configuration>
- oRPC contract-first (v1): <https://v1.orpc.dev/docs/contract-first/implement-contract>
- TanStack Query options: <https://tanstack.com/query/latest/docs/framework/react/guides/query-options>
- MCP tools (2026-07-28): <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>

## Development

```sh
pnpm install
pnpm check   # typecheck sources + type tests + every README/docs code block
```
