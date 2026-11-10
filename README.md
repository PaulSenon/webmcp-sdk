<img src="assets/icon.svg" width="64" height="64" alt="">

# webmcp-sdk

Type-safe [WebMCP](https://webmachinelearning.github.io/webmcp/) tools for TypeScript.

WebMCP lets a web page expose functions ("tools") to AI agents through `document.modelContext`. With **webmcp-sdk** you:

- **define** tools with [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, Effect…);
- **implement** them with fully inferred types;
- **register** them with automatic input/output validation and agent-readable errors;
- **discover and call** the tools of a page from an in-page agent.

The core is framework-agnostic. React bindings are included.

> [!WARNING]
> **Design prototype, not usable yet.** This repository contains the complete typed API and its documentation. Every runtime function throws `NotImplementedError`, and nothing is published to npm. WebMCP itself is an experimental W3C Community Group draft (see [Platform status](#platform-status)).

```ts nocheck
defineTool({...})   →   implementTool(definition, handler)   →   registerTools([...])
   what (contract)          how (your code)                       where & when
```

**Contents:**
[Quick start](#quick-start) ·
[Defining tools](#defining-tools) ·
[Implementing tools](#implementing-tools) ·
[Errors](#errors) ·
[Registering tools](#registering-tools) ·
[React](#react) ·
[Discovering and calling tools](#discovering-and-calling-tools-experimental) ·
[Testing](#testing) ·
[What agents receive](#what-agents-receive) ·
[Limitations](#limitations) ·
[Platform status](#platform-status)

---

## Quick start

```ts
import { z } from "zod";
import { defineTool, implementTool, registerTools } from "webmcp-sdk";

const todos: string[] = [];

// 1. Define: the agent-facing contract
const addTodo = defineTool({
  name: "add_todo",
  title: "Add todo",
  description: "Add an item to the user's todo list. Returns the new item count.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ count: z.number() }),
});

// 2. Implement: input and output types come from the definition
const addTodoTool = implementTool(addTodo, ({ text }) => {
  todos.push(text);
  return { count: todos.length };
});

// 3. Register: safe everywhere, a no-op where WebMCP is unavailable
const registration = registerTools([addTodoTool]);
// later
registration.unregister();
```

Here is what the SDK does for you:

- **Validates arguments** before your handler runs. The browser does not. Invalid arguments come back to the agent with field paths, and your handler is not called.
- **Validates your result** against `output` when you declare one.
- **Publishes a JSON Schema** of the input (and output) generated from the same schemas.
- **Turns failures into short, actionable messages** for the agent, without leaking internals.
- **Never breaks your app.** Without WebMCP (most browsers today, SSR), registration does nothing and never throws.

**Requirements:** TypeScript ≥ 5.4, a Standard Schema library with JSON Schema support (e.g. Zod ≥ 4.2), and React ≥ 18 for the bindings. **To try it** (once implemented), you need a browser with WebMCP enabled, or the official polyfill: see [Platform status](#platform-status).

---

## Defining tools

A definition is a plain object: name, metadata and schemas. It has no code and no browser dependency, so you can share it between the page that implements the tool, your tests, and code that calls the tool.

```ts file=definitions.ts
// definitions.ts
import { z } from "zod";
import { defineTool } from "webmcp-sdk";

export const searchProducts = defineTool({
  name: "search_products",
  title: "Search products",
  description: "Search the catalog by keyword. Returns at most `limit` products.",
  input: z.object({
    q: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({ hits: z.array(z.object({ sku: z.string(), title: z.string() })) }),
  annotations: { readOnlyHint: true },
});

export const addToCart = defineTool({
  name: "add_to_cart",
  description: "Add a product to the cart by SKU. Returns the new item count.",
  input: z.object({ sku: z.string(), quantity: z.number().int().min(1).default(1) }),
  output: z.object({ itemCount: z.number().int() }),
});
```

| field | |
| ----- | - |
| `name` | unique in the document; 1–128 of `A–Z a–z 0–9 _ - .`. **A name is a contract:** if a tool's meaning changes, give it a new name |
| `title` | optional human-readable label |
| `description` | what the tool does and when to use it; agents read this to choose |
| `input` | optional object schema for the arguments |
| `output` | optional schema for the result. If declared, every result is validated against it |
| `annotations` | WebMCP hints for agents (not enforced): `readOnlyHint`, `consequentialHint`, `untrustedContentHint`, `debugging` |

Pass a schema or omit the property. A schema that *may* be `undefined` (`input: cond ? schema : undefined`) is a compile error; define two tools instead.

`defineTool` is the only function that throws: `WebMCPError("invalid_definition")` for an invalid name or an empty description, because those are programming errors.

### Schemas: any Standard Schema library

A tool schema needs two capabilities. **Validation** checks values at runtime. **JSON Schema conversion** describes the tool to agents. The compiler requires both.

| library | how |
| ------- | --- |
| Zod ≥ 4.2, ArkType ≥ 2.1 | pass the schema directly |
| Valibot | wrap with `toStandardJsonSchema(schema)` from `@valibot/to-json-schema` |
| Effect 4 | `Schema.toStandardJSONSchemaV1(schema)` |
| anything else | `withJsonSchema(schema, { input, output? })` |

```ts
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import { defineTool, withJsonSchema, type StandardSchemaV1 } from "webmcp-sdk";

defineTool({ name: "lookup", description: "Find an order by id.", input: type({ id: "string" }) });

defineTool({
  name: "search_docs",
  description: "Search the documentation.",
  input: toStandardJsonSchema(v.object({ query: v.pipe(v.string(), v.minLength(1)) })),
});

declare const legacy: StandardSchemaV1<{ q: string }>; // validates, but cannot describe itself
defineTool({
  name: "legacy_search",
  description: "Search with the legacy validator.",
  input: withJsonSchema(legacy, { input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }),
});

defineTool({
  name: "bad_schema",
  description: "Rejected at compile time.",
  // @ts-expect-error Property 'jsonSchema' is missing: validation-only schema
  input: v.object({ query: v.string() }),
});
```

- **Your validator is the source of truth.** The SDK always runs your original validator through the Standard Schema API. The JSON Schema only describes the tool to agents. With `withJsonSchema`, keeping the two in sync is up to you.
- **Input must describe an object.** `z.string()`, arrays, `z.any()` and `z.never()` are compile errors.

### Input side and output side

Transforms and defaults give a schema two types. The SDK uses the right one on each side:

| | the agent sees (JSON Schema) | your handler sees |
| - | ---------------------------- | ----------------- |
| `input` | the **input** side (`limit` optional) | the **output** side (`limit: number`, defaults applied) |
| `output` | the **output** side | it returns the **input** side |

```ts
import { z } from "zod";
import { defineTool, implementTool, type InferToolInput, type InferToolOutput } from "webmcp-sdk";

const scheduleMeeting = defineTool({
  name: "schedule_meeting",
  description: "Schedule a meeting. `start` is an ISO 8601 date-time.",
  input: z.object({ start: z.iso.datetime(), minutes: z.number().int().default(30) }),
  output: z.object({ id: z.string(), start: z.date().transform((d) => d.toISOString()) }),
});

type AgentSends = InferToolInput<typeof scheduleMeeting>; // { start: string; minutes?: number | undefined }
type AgentGets = InferToolOutput<typeof scheduleMeeting>; // { id: string; start: string }

implementTool(scheduleMeeting, ({ start, minutes }) => {
  // minutes: number (default applied); return a Date, the agent receives a string
  return { id: "m_1", start: new Date(Date.parse(start) + minutes * 60_000) };
});
```

### Async validation and refinements

Validators may be async, and the SDK always awaits them. Refinements are **not** expressible in JSON Schema, so repeat the rule in the description:

```ts
import { z } from "zod";
import { defineTool } from "webmcp-sdk";
declare function skuExists(sku: string): Promise<boolean>;

defineTool({
  name: "reorder",
  description: "Reorder a product. The SKU must exist (see search_products).",
  input: z.object({ sku: z.string() }).refine(async ({ sku }) => skuExists(sku), {
    message: "Unknown SKU. Call search_products to find valid SKUs.",
    path: ["sku"],
  }),
});
```

### Schemas that cannot become JSON Schema

The types only check that a library *can* convert. A particular schema can still fail at runtime, for example Zod `z.date()` on the advertised side. Conversion runs when the tool is registered. A failure marks that tool `"error"` (`json_schema_unavailable`) and registers nothing for it (a non-object input root is reported the same way). Catch it in CI with [`toJSONSchema`](#testing). Fix it by choosing a wire type (`z.iso.datetime()`) or using `withJsonSchema`. The SDK never weakens a schema silently.

---

## Implementing tools

`implementTool(definition, handler)` attaches your code to a definition. The handler receives the validated input and `{ signal }`, and returns the output (sync or async):

```ts
import { implementTool } from "webmcp-sdk";
import { searchProducts } from "./definitions.js";
declare const api: { search(q: string, limit: number, signal: AbortSignal): Promise<{ sku: string; title: string }[]> };

export const searchProductsTool = implementTool(searchProducts, async ({ q, limit }, { signal }) => {
  return { hits: await api.search(q, limit, signal) };
});
```

### Dependencies: one factory per implementation

When a tool needs data from your app (a store, the current user, a component's state), make the implementation a function of exactly that data:

```ts
import { implementTool } from "webmcp-sdk";
import { addToCart } from "./definitions.js";

interface Cart { add(sku: string, quantity: number): Promise<number> }

export const addToCartTool = ({ cart }: { cart: Cart }) =>
  implementTool(addToCart, async ({ sku, quantity }) => ({ itemCount: await cart.add(sku, quantity) }));

// Composition happens where you register:
declare const cart: Cart;
const tools = [addToCartTool({ cart })];
```

- **Each tool stays isolated** and testable: `addToCartTool({ cart: fakeCart })`.
- **Forgetting a dependency is a compile error.**
- **Agents never see these dependencies.** They are not arguments.
- If several places register the same set, write a function that calls the per-tool factories.

### Without an output schema

A handler may return any JSON value, or nothing (sent as `null`). `Date`, `bigint` and functions are compile errors. The SDK serializes the result itself, so a runtime failure (a cycle, for example) becomes a clear [`output_invalid`](#what-agents-receive). Note that `JSON.stringify` is lossy without failing: it drops `undefined` and functions in objects, and turns `Date` into a string. Declare an `output` schema when the shape matters. Values typed with an `interface` are rejected by TypeScript's index-signature rule (type aliases and object literals are fine): declare an output schema (recommended) or spread the value (`{ ...value }`). The same applies to `ToolError` `data`.

### Outcomes are outputs: user confirmation

A user declining a confirmation is a normal result, not an error. Declare it in your output:

```ts
import { z } from "zod";
import { defineTool, implementTool } from "webmcp-sdk";
declare function confirmDialog(text: string): Promise<boolean>;
declare function placeOrder(): Promise<string>;

const checkout = defineTool({
  name: "checkout",
  description: "Place the order. The user is asked to confirm; if they decline, do not retry unless they ask.",
  annotations: { consequentialHint: true },
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("placed"), orderId: z.string() }),
    z.object({ status: z.literal("declined"), message: z.string() }),
  ]),
});

export const checkoutTool = implementTool(checkout, async () => {
  if (!(await confirmDialog("Place this order?"))) {
    return { status: "declined", message: "The user declined. Do not retry unless they ask again." };
  }
  return { status: "placed", orderId: await placeOrder() };
});
```

The confirmation UI is your page's own code: WebMCP's current draft has no API for it.

---

## Errors

Throw `ToolError` for failures the agent should understand. Anything else stays private.

```ts
import { implementTool, ToolError } from "webmcp-sdk";
import { addToCart } from "./definitions.js";

interface Stock { available(sku: string): Promise<number>; reserve(sku: string, n: number): Promise<number> }

export const reserveStockTool = ({ stock }: { stock: Stock }) =>
  implementTool(addToCart, async ({ sku, quantity }) => {
    const left = await stock.available(sku);
    if (left < quantity) {
      throw new ToolError(`Only ${left} left. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { left } });
    }
    return { itemCount: await stock.reserve(sku, quantity) };
  });
```

- **`message`** (required) is what the agent reads, so make it say what to do next.
- **`code`** (optional) is a stable identifier for programs.
- **`data`** (optional) carries JSON facts.
- **`cause`** stays local.

Only these three fields are sent: never `stack`, `cause`, or other properties.

Subclasses work the same way. Put whatever should reach the agent in `data`:

```ts
import { ToolError } from "webmcp-sdk";

export class OutOfStockError extends ToolError {
  constructor(readonly sku: string, left: number) {
    super(`Only ${left} left for ${sku}. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { sku, left } });
  }
}
```

**Anything else thrown is a defect.** The agent gets a generic message (`"internal"`), and you get the original via `onUnexpectedError`. It is also called for `output_invalid` and for `ToolError` data that could not be serialized, and never for `input_invalid` or a valid `ToolError`:

```ts
import { registerTools } from "webmcp-sdk";
import { addToCartTool, type Cart } from "./tools.js";
declare const cart: Cart;

registerTools([addToCartTool({ cart })], {
  onUnexpectedError: (error, { toolName, kind, handlerCalled }) => console.error(toolName, kind, handlerCalled, error),
});
```

`ToolError` is recognized by a brand (`isToolError`), so it also works if two copies of the package end up in your bundle. **What you write explicitly** in `message` or `data` is sent as-is. Do not forward third-party error messages blindly.

---

## What agents receive

**On success:** your validated output, as-is.

**On failure:** an envelope, returned rather than thrown. In WebMCP, a thrown error reaches the agent as an opaque `OperationError` without its message.

```json
{ "isError": true, "error": { "kind": "input_invalid", "handlerCalled": false,
  "message": "Arguments rejected; the tool did not run. Fix the fields below and call again.",
  "issues": [{ "path": "quantity", "message": "Too small: expected number to be >=1" }] } }
```

| `kind` | `handlerCalled` | when | extra fields |
| ------ | --------------- | ---- | ------------ |
| `input_invalid` | `false` | arguments failed the input schema; the tool did not run | `issues` (at most 20, readable paths), `omittedIssues` when more were found |
| `tool_error` | `true` | the handler threw a `ToolError` | `code`, `data` |
| `internal` | `true` / `false` | an unexpected error (a defect, or a validator that crashed); no details | — |
| `output_invalid` | `true` | the tool ran, but its result failed the declared output and was withheld; **the action may have been performed** | — |

- **`handlerCalled`** is a fact, not a promise. When it is `true`, effects may have happened, so agents should check the current state before retrying. The SDK never claims a retry is safe.
- **`outputSchema`:** when a tool declares an `output`, it is advertised as `anyOf: [<your output>, <the envelope>]`, so strict agents do not discard failures as malformed. Without one, no `outputSchema` is advertised.
- **Detection:** `isToolFailureEnvelope(value)` checks `isError === true`, a known `kind` and a string `message`.

---

## Registering tools

`registerTools(tools, options?)` registers tools in the current document and returns a **handle**:

```ts
import { registerTools } from "webmcp-sdk";
import { addToCartTool, checkoutTool, searchProductsTool, type Cart } from "./tools.js";
declare const cart: Cart;
declare const nextCart: Cart;

const reg = registerTools([searchProductsTool, addToCartTool({ cart })]);

// The desired list changed: declare it again, and the SDK reconciles
reg.update([searchProductsTool, addToCartTool({ cart }), checkoutTool]);

// Fresh dependencies for the same definitions: handlers refreshed, nothing re-registered
reg.update([searchProductsTool, addToCartTool({ cart: nextCart }), checkoutTool]);

// Per-tool state, once the current list is reconciled
const snapshot = await reg.settled();
for (const t of snapshot.tools) {
  if (t.state === "error") console.warn(t.name, t.error.code); // duplicate_name, json_schema_unavailable, registration_failed
}
const unsubscribe = reg.subscribe((snapshot) => console.log(snapshot.supported, snapshot.tools));

// Remove everything (or abort the `signal` option). The handle is then finished: `update` is ignored.
reg.unregister();
unsubscribe();
```

```ts file=tools.ts
// tools.ts (used above)
import { defineTool, implementTool } from "webmcp-sdk";
import { addToCart, searchProducts } from "./definitions.js";
export interface Cart { add(sku: string, quantity: number): Promise<number> }
export const searchProductsTool = implementTool(searchProducts, () => ({ hits: [] }));
export const addToCartTool = ({ cart }: { cart: Cart }) =>
  implementTool(addToCart, async ({ sku, quantity }) => ({ itemCount: await cart.add(sku, quantity) }));
export const checkoutTool = implementTool(defineTool({ name: "checkout", description: "Go to checkout." }), () => null);
```


How `update` reconciles:

- **Tools are matched by definition identity, not by array.** Recreating implementations (factories) only refreshes their handlers.
- **Removed definitions are unregistered first,** then added ones are registered. A replacement with the same name waits for the old one to be gone.
- **Each tool succeeds or fails on its own.** One failure does not roll back the others.
- **`update` copies the list.** Mutating the array afterwards has no effect until the next `update`.
- **Calls already running are never cancelled** by `update` or `unregister`. They finish with the definition and handler they started with. The handler's `signal` only aborts when the *caller* cancels or unloads.
- **Duplicate names** are a compile error for literal names in array literals (also after a conditional spread), and a per-tool `duplicate_name` state otherwise (`.map()`, dynamic arrays). The SDK never takes over a name registered by other code.

Each tool's `state` is one of:

- `"pending"`: being registered, or queued behind a previous registration of the same name.
- `"registered"`.
- `"unsupported"`: no WebMCP here.
- `"error"`, with `error.code` set to `duplicate_name`, `json_schema_unavailable` or `registration_failed`.

| option | |
| ------ | - |
| `signal` | aborting it is the same as `unregister()` |
| `modelContext` | a polyfill or test double instead of `document.modelContext` |
| `exposedTo` | origins allowed to see these tools from other frames (enforced by the browser), fixed for the registration |
| `onUnexpectedError` | logging hook, see [Errors](#errors) |

**Progressive enhancement.** Without WebMCP, nothing throws and `update` stays cheap:

- **Registration:** `snapshot.supported` is `false` and every tool is `"unsupported"`.
- **Discovery:** the catalog's `status` is `"unsupported"`.

To *require* WebMCP, check `supported` yourself. No polyfill is installed automatically. To use one, pass it as `modelContext` or install it before registering.

---

## React

`webmcp-sdk/react` contains thin bindings over the same core.

```tsx
import { useState } from "react";
import { z } from "zod";
import { defineTool, implementTool } from "webmcp-sdk";
import { RegisterTools, useRegisterTools } from "webmcp-sdk/react";

// Module scope: stable definitions
const applyFilter = defineTool({
  name: "apply_filter",
  description: "Filter the dashboard by status.",
  input: z.object({ status: z.enum(["open", "closed", "all"]) }),
  output: z.object({ visible: z.number() }),
});
const exportCsv = defineTool({ name: "export_csv", description: "Download the visible rows as CSV." });

// One factory per implementation: dependencies are explicit parameters
const applyFilterTool = ({ setStatus, rows }: { setStatus: (s: string) => void; rows: { status: string }[] }) =>
  implementTool(applyFilter, ({ status }) => {
    setStatus(status);
    return { visible: status === "all" ? rows.length : rows.filter((r) => r.status === status).length };
  });
const exportCsvTool = ({ rows }: { rows: unknown[] }) => implementTool(exportCsv, () => ({ exported: rows.length }));

export function Dashboard({ rows }: { rows: { status: string }[] }) {
  const [status, setStatus] = useState("all");

  // Registered on mount, unregistered on unmount. Re-renders refresh handlers without re-registering.
  const { supported } = useRegisterTools([applyFilterTool({ setStatus, rows })]);

  return (
    <>
      {supported && <small>AI tools available</small>}
      <p>Showing {status}</p>
      {/* Available only while rendered */}
      {rows.length > 0 && <RegisterTools tools={[exportCsvTool({ rows })]} />}
    </>
  );
}
```

| | behaviour |
| - | --------- |
| SSR / first render | nothing happens; `supported: undefined` |
| mount / unmount | register / unregister |
| re-render | `update(tools)` after commit: handlers refreshed, only added/removed definitions change |
| a call starting between a render and its commit | uses the previous handler |
| StrictMode double mount | register → unregister → register; no spurious `duplicate_name` |
| unmount while a call runs | the call finishes. A handler that must stop with its component needs its own `AbortController`, owned by your code |
| no WebMCP | `supported: false`, tools `"unsupported"`; nothing throws |
| errors | never thrown during render; per tool in the returned snapshot |

Keep **definitions** at module scope. Implementations can be recreated freely. A definition created during render is a new tool on every render, so it is re-registered every time (a dev warning is logged).

Options:

- `enabled` (`false` unregisters).
- `modelContext` and `exposedTo` (compared by value): changing either re-creates the registration.
- `onUnexpectedError`: the latest value is always used.

---

## Discovering and calling tools (experimental)

For **in-page agents**, such as a chat widget or a copilot running in the page, that need the tools exposed by the page and its frames. This wraps the draft's `getTools()`, `executeTool()` and `toolchange`.

```ts
import { createToolCatalog, toProviderName, type ToolCatalogSnapshot } from "webmcp-sdk";

declare const agent: { setTools(tools: { name: string; description: string; parameters: object }[]): void };

const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"] });
const idByName = new Map<string, string>(); // provider name → id

// Send the tool list to your LLM now, and again whenever it changes
function sync({ tools }: ToolCatalogSnapshot) {
  idByName.clear();
  agent.setTools(
    tools.map((t) => {
      const name = toProviderName(t.id); // provider-safe (default: ≤ 64 chars, [a-zA-Z0-9_-])
      idByName.set(name, t.id);
      return { name, description: t.description, parameters: t.inputSchema };
    }),
  );
}
sync(catalog.getSnapshot());
const stop = catalog.subscribe(sync); // the first subscriber starts discovery

// When the LLM calls a tool
async function onToolCall(name: string, args: unknown) {
  const id = idByName.get(name);
  if (!id) return { error: `Unknown tool "${name}".` };
  const result = await catalog.call(id, args);
  return result.ok ? result.value : { error: result.error.message };
}

// When the agent goes away
function teardown() {
  stop();
  catalog.dispose();
}
```

| `ToolCatalog` | |
| ------------- | - |
| `getSnapshot()` | `{ status, tools, error?, version }`. `status` is `"idle"`, `"loading"`, `"ready"`, `"unsupported"` or `"error"`. `version` counts snapshots; it is not a tool revision |
| `subscribe(fn)` | called on each new snapshot, not on subscribe; the first subscriber starts discovery and the `toolchange` listener, the last one stops them |
| `getTools()` | query now; returns the list (and updates the snapshot) |
| `update({ fromOrigins })` | change the origins (compared by value) |
| `call(id, input, { signal })` | call by id; runs a discovery first if none happened yet; never throws |
| `find(definition)` | typed entries for a definition you know (below) |
| `dispose()` | stop everything; later calls return `not_found` |

**Ids.** Each tool gets a stable, **opaque** string id, such as `"self__search"` (do not parse it). The source is `self` for this page, or `f1`, `f2`… for other frames, assigned once per frame and origin and never reused.

- **Same name in two frames:** `self__search` and `f1__search` stay distinct, whatever order they register in.
- **Re-registration:** a tool re-registered under the same name keeps its id.
- **Scope:** ids are stable for the page session. Never persist them.
- **`title` and `name`** are display data and may repeat.

**Calls go to the tool currently registered under that id.**

- **Replaced tool:** if it was replaced, the new version is called, and it validates your arguments against its current schema.
- **Gone tool:** if it no longer exists, you get `{ ok: false, error: { kind: "not_found" } }` and nothing runs.
- **Never throws:** failures are values (`not_found`, `tool_failed`, `rejected`), each with a `message`.

**Known tools are typed by their definition.** Discovery happens at runtime, so on its own it only knows `unknown`. If you share the definition with the page that implements it, `find` gives you typed calls. They are validated on your side too: your input before sending (the original value is sent, since the provider validates again), and the result on return.

```ts
import { createToolCatalog } from "webmcp-sdk";
import { searchProducts } from "./definitions.js";

const catalog = createToolCatalog();
const [search] = await catalog.find(searchProducts); // one entry per source exposing "search_products"
if (search) {
  const r = await search.call({ q: "red shoes" }); // typed; validated locally before sending
  if (r.ok) console.log(r.value.hits.map((h) => h.title)); // validated against the definition's output
}
```

**React:**

```tsx
import { useToolCatalog } from "webmcp-sdk/react";

export function ToolList() {
  const { status, tools } = useToolCatalog({ fromOrigins: ["https://widgets.example"] });
  if (status === "unsupported") return null;
  return <ul>{tools.map((t) => <li key={t.id}>{t.title ?? t.name} <small>{t.source.origin}</small></li>)}</ul>;
}
```

`useToolCatalog` handles initial discovery, `toolchange` updates and cleanup. `fromOrigins` is compared by value, so inline arrays are fine. Ids are unaffected by remounts.

**Security.** `fromOrigins` only filters what you ask for. A cross-origin tool appears only if its page registered it with `exposedTo` your origin. The browser and its permissions policy remain the only authority.

---

## Testing

Definitions and implementations are plain values, so tests need no browser:

```ts
import { runTool, toJSONSchema } from "webmcp-sdk";
import { addToCartTool, type Cart } from "./tools.js";
import { addToCart } from "./definitions.js";

const fakeCart: Cart = { add: async () => 1 };

// Exactly what a registration would run: validate input → handler → validate output → map failures
const ok = await runTool(addToCartTool({ cart: fakeCart }), { sku: "TEE-1" });
const bad = await runTool(addToCartTool({ cart: fakeCart }), { sku: 42 });
if (!bad.ok && bad.failure.kind === "input_invalid") console.log(bad.failure.issues);

// Catch non-convertible schemas in CI
const schemas = toJSONSchema(addToCart);
for (const [side, r] of Object.entries(schemas)) if (r && !r.ok) throw new Error(`${side}: ${r.message}`);
```

For registration tests, pass any object with a `registerTool` method as `modelContext`, or install [`@w3c/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill).

---

## Limitations

- **Failures are in-band.** The platform, and any host that does not understand the envelope, sees a failed call as a *successful* call whose content says `isError: true`.
- **Types are compile-time only.** Runtime truth comes from your validators, which run on every call.
- **JSON Schema is only as good as your library's converter.** Refinements and transforms are not expressible, so say them in `description`.
- **Envelope ambiguity.** A *successful* result shaped exactly like `{ isError: true, error: { kind, message } }`, with a known `kind`, is indistinguishable from a failure on the wire. The SDK does not restrict your schemas; avoid that shape in outputs.
- **Cancellation is cooperative.** No stop or rollback is ever guaranteed. Removing a tool does not stop calls already running.
- **Discovery identity is best-effort.** The platform has no registration id. A tool replaced by an identical one, or a same-origin frame navigating to a page with the same tool, is indistinguishable.
- **No security layer.** Cross-origin access is entirely the browser's `exposedTo` / `fromOrigins` / permissions-policy model.
- **Out of scope for now:** declarative (HTML form) tools, workers, bindings other than React, MCP transports.

## Platform status

As of 2026-11-10 (details and sources in [`docs/research.md`](docs/research.md)):

- **Spec:** [WebMCP Draft CG Report, 9 Nov 2026](https://webmachinelearning.github.io/webmcp/). **Experimental**, not on the W3C standards track.
  - Entry point `document.modelContext` (secure contexts).
  - `registerTool(tool, { signal, exposedTo })`.
  - `getTools({ fromOrigins })` / `executeTool()` / `toolchange`.
- **Chrome:** origin trial (from 149) and `chrome://flags/#enable-webmcp-testing`. No confirmed shipping in other engines.
- **Polyfill:** [`@w3c/webmcp-polyfill`](https://github.com/webmachinelearning/webmcp-polyfill) 0.1.0. It currently ignores `outputSchema`.

## Project status

| | |
| - | - |
| API surface (core + React) | typed, documented, type-tested |
| runtime | not implemented (`NotImplementedError`) |
| npm | not published |
| license | not chosen yet |

Design rationale and decisions: [`docs/design.md`](docs/design.md).

## Development

```sh
pnpm install
pnpm check   # typecheck sources, type tests, and every TypeScript block in this README
```
