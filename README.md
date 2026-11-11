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
defineTool({...})   →   implementTool(definition, handler)   →   registerTool(tool, { signal })
   what (contract)          how (your code)                       where & when (WebMCP's own lifetime model)
```

**Contents:**
[Quick start](#quick-start) ·
[Defining tools](#defining-tools) ·
[Implementing tools](#implementing-tools) ·
[Errors](#errors) ·
[What agents receive](#what-agents-receive) ·
[Registering tools](#registering-tools) ·
[Polyfills](#polyfills-and-custom-model-contexts) ·
[React](#react) ·
[Discovering and calling tools](#discovering-and-calling-tools-experimental) ·
[Testing](#testing) ·
[Limitations](#limitations) ·
[Platform status](#platform-status)

---

## Quick start

```ts
import { z } from "zod";
import { defineTool, implementTool, registerTool } from "webmcp-sdk";

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

// 3. Register, with WebMCP's own lifetime model: an AbortSignal
const controller = new AbortController();
await registerTool(addTodoTool, { signal: controller.signal }); // "registered", or "unsupported" without WebMCP; rejects on real failures (e.g. duplicate name)
// later: remove the tool
controller.abort();
```

Here is what the SDK does for you:

- **Validates arguments** before your handler runs. The browser does not. Invalid arguments come back to the agent with field paths, and your handler is not called.
- **Validates your result** against `output` when you declare one.
- **Publishes a JSON Schema** of the input (and output) generated from the same schemas.
- **Turns failures into short, actionable messages** for the agent, without leaking internals.
- **Stays out of the way without WebMCP.** In most browsers today, and during SSR, registration resolves `"unsupported"` and does nothing. Real failures (a duplicate name, for example) reject, like the native call.

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
import { registerTool } from "webmcp-sdk";
import { addToCartTool, type Cart } from "./tools.js";
declare const cart: Cart;

await registerTool(addToCartTool({ cart }), {
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

Registration mirrors WebMCP's `registerTool(tool, { signal })`: **the `signal` is the tool's lifetime**, and aborting it removes the tool. On top, the SDK adds definitions, validation, types and agent-readable failures.

```ts file=tools.ts
// tools.ts (used in the examples below)
import { defineTool, implementTool } from "webmcp-sdk";
import { addToCart, searchProducts } from "./definitions.js";
export interface Cart { add(sku: string, quantity: number): Promise<number> }
export const searchProductsTool = implementTool(searchProducts, () => ({ hits: [] }));
export const addToCartTool = ({ cart }: { cart: Cart }) =>
  implementTool(addToCart, async ({ sku, quantity }) => ({ itemCount: await cart.add(sku, quantity) }));
export const checkoutTool = implementTool(defineTool({ name: "checkout", description: "Go to checkout." }), () => null);
```

**One tool:**

```ts
import { registerTool } from "webmcp-sdk";
import { searchProductsTool } from "./tools.js";

const controller = new AbortController();
const status = await registerTool(searchProductsTool, { signal: controller.signal }); // "registered" | "unsupported"

controller.abort(); // removes it
```

**A group: one call, one lifetime, one cleanup:**

```ts
import { registerTools } from "webmcp-sdk";
import { addToCartTool, checkoutTool, searchProductsTool, type Cart } from "./tools.js";
declare const cart: Cart;

const shop = new AbortController();
const results = await registerTools([searchProductsTool, addToCartTool({ cart }), checkoutTool], { signal: shop.signal });

for (const r of results) {
  if (r.status === "error") console.warn(r.name, r.error.code); // duplicate_name, json_schema_unavailable, registration_failed
}

shop.abort(); // removes every tool registered by this call
```

- **Who cleans up:** whoever owns the `AbortController`. There is nothing else to keep. To tie tools to an existing lifetime, such as a route, a component or `AbortSignal.any([...])`, pass that signal.
- **Several lifetimes** mean several calls with different signals.
- **`registerTool` rejects** with a `WebMCPError` on real failures (`duplicate_name`, `json_schema_unavailable`, `registration_failed`), like the native call.
- **`registerTools` never rejects for one tool.** It resolves with one result per tool. The tools that succeeded stay registered under the signal, and failed ones need no cleanup. There is no rollback: if you want "all or nothing", check the results and `abort()`.
- **Abort timing:** both reject with `signal.reason` if the signal is already aborted or aborts while registering.
- **Running calls are never cancelled by `abort()`,** exactly as in WebMCP. They finish with the handler they started with, and their result is still delivered.
- **The handler's `signal`** aborts when the caller cancels, or when the caller's page unloads; the browser then discards any late result. It does not abort when the tool is removed, nor when the page hosting the tool unloads (the caller then gets an `AbortError`, and WebMCP specifies nothing more).
- **Changing a tool** (a new handler or a new definition) in plain TypeScript: abort it and register the new implementation. Calls for the same name are ordered internally.
- **Duplicate names** are a compile error for literal arrays passed to `registerTools`, and a `duplicate_name` error at runtime otherwise. The SDK never takes over a name registered by other code.

**In your own effects** (Vue, Svelte, Solid, a hand-written React effect), cleanup may run before registration has settled, and the promise then rejects with the abort reason. Ignore that one:

```ts
import { registerTool } from "webmcp-sdk";
import { searchProductsTool } from "./tools.js";

function effect() {
  const controller = new AbortController();
  registerTool(searchProductsTool, { signal: controller.signal }).catch((e) => {
    if (e !== controller.signal.reason) console.error(e); // a real failure
  });
  return () => controller.abort(); // cleanup
}
```

React users never need this: the hooks do it.

| option | |
| ------ | - |
| `signal` | the lifetime; aborting it removes the tool(s) |
| `exposedTo` | origins allowed to see these tools from other frames (enforced by the browser) |
| `modelContext` | a context to use instead of `document.modelContext` (see [Polyfills](#polyfills-and-custom-model-contexts)) |
| `onUnexpectedError` | logging hook, see [Errors](#errors) |

**Progressive enhancement:** without WebMCP, registration resolves `"unsupported"` and nothing throws. To *require* WebMCP, check the status yourself.

---

## Polyfills and custom model contexts

The SDK never installs or imports a polyfill, which keeps progressive enhancement intact. It uses `document.modelContext` when it exists, or the object you pass as `modelContext`.

**With the official polyfill** ([`@w3c/webmcp-polyfill`](https://www.npmjs.com/package/@w3c/webmcp-polyfill), 0.1.0). It installs `document.modelContext` globally, and is a no-op where a native implementation exists. Install it in your browser entry, before registering:

```ts nocheck
// main.ts (browser entry; not in server code)
import "@w3c/webmcp-polyfill/auto"; // or: import { installWebMCP } from "@w3c/webmcp-polyfill"; installWebMCP();
```

- **React** works the same way: install it before `createRoot(...).render(...)`.
- **Explicit context:** `modelContext` (on `registerTool(s)`, `createToolCatalog` and the hooks) takes any object with the WebMCP shape. It is used as-is and never falls back to `document`. It is mainly useful for test doubles: the polyfills known today (`@w3c/webmcp-polyfill`, `@mcp-b/*`) install themselves globally rather than hand out instances. The official polyfill's types are checked against these options.
- **Installing late:** `registerTool` looks for `document.modelContext` when called, the React hooks look again on a later render, and catalogs look again on `getTools()` / `update()`. Installing before your app starts is simpler.

**Polyfill limits** (from its documentation, 0.1.0):

- It must be installed in **each frame**. Polyfilled and native frames do not see each other's tools.
- It exposes tools to **in-page** consumers only, not to a browser's built-in agent.
- It currently ignores `outputSchema` and fires no `toolcancel`.

---

## React

`webmcp-sdk/react` owns the lifetimes for you: there is no `register`, `abort` or cleanup to write.

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

  // Registered while mounted. Re-renders refresh handlers without re-registering.
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
| mount / unmount | registers / removes the tools |
| re-render | handlers refreshed; only added or removed definitions are registered or removed |
| a call starting between a render and its commit | uses the previous handler |
| StrictMode double mount | register → remove → register; no spurious `duplicate_name` |
| unmount while a call runs | the call finishes; a handler that must stop with its component needs its own `AbortController` |
| no WebMCP | `supported: false`, tools `"unsupported"`; nothing throws |
| errors | never thrown during render; per tool in `tools[i].error` |
| name already registered by another `useRegisterTools` | `duplicate_name`, retried automatically when that registration ends (conflicts with other code stay errors) |

- **Keep definitions at module scope.** Implementations can be recreated freely.
- **A definition created during render** is a new tool on every render, so it is re-registered every time (a dev warning is logged).
- **Options:**
  - `enabled` (`false` removes the tools);
  - `modelContext` and `exposedTo` (compared by value; changing either re-registers);
  - `onUnexpectedError`.

---

## Discovering and calling tools (experimental)

For **in-page agents**, such as a chat widget or a copilot running in the page, that need the tools exposed by the page and its frames. A **catalog** handles discovery, change tracking, naming and routing. You only adapt its list to your model's format.

```ts
import { createToolCatalog } from "webmcp-sdk";

const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"] }); // you own it; no global state

// Before each model request: a fresh snapshot
const tools = await catalog.getTools(); // [{ name, description, inputSchema, … }]

// When the model calls a tool: pass its name and arguments straight back
declare const toolCall: { toolName: string; input: unknown };
if (catalog.isCatalogTool(toolCall.toolName)) {
  const result = await catalog.callTool(toolCall.toolName, toolCall.input);
  // result.ok ? result.value : result.error (each error has a `message`; `tool_failed` carries the tool's `failure`)
}
```

| `createToolCatalog` option | |
| -------------------------- | - |
| `fromOrigins` | other origins to include (native filter; owners must still expose their tools to you) |
| `modelContext` | a context to use instead of `document.modelContext` |
| `maxNameLength` | maximum length of issued names, default `64` |
| `namePrefix` | prefix for every issued name (see [Several catalogs](#several-catalogs-or-your-own-tools-in-one-model)) |

| method | |
| ------ | - |
| `getTools()` | queries now; never rejects (`[]` when unsupported or on error, and the snapshot's `status` says why) |
| `getSnapshot()` | the latest result, synchronously: `{ status, tools, error?, version }` |
| `subscribe(listener)` | for code that reacts to changes; returns a function that stops that listener only |
| `isCatalogTool(name)` | routing: was this name issued by this catalog? |
| `callTool(name, input, { signal })` | calls the tool; never throws |
| `update({ fromOrigins })` | changes the origins (compared by value) |
| `dispose()` | ends the catalog and every listener |

**Names.** Each tool gets **one** name, issued by the catalog, which you give to the model and get back unchanged:

- **Unique within the catalog.** Provider-safe: `[A-Za-z0-9_-]`, at most 64 characters (`maxNameLength`).
- **Shaped `<source>__<tool name>`**, e.g. `self__search`, `f1__search`. The **source** is the document the tool comes from: one window or frame, at one origin. `self` is your page, and `f1`, `f2`… are frames in the order they were first seen. A frame that navigates to another origin becomes a new source. Do not parse names: use `webmcpName`, `origin` and `isSameDocument`. The source tag is on every name, so two frames exposing `search` never collide, whatever order they register in. If two names of one source become identical once shortened or normalized, the catalog adds `_2`, `_3`… internally.
- **Stable for the catalog's lifetime,** including when a tool is unregistered and registered again. Not across page reloads, and never persisted.
- **`webmcpName`** keeps the page's original name for display.

**Calls.**

- **`callTool(name, input)`** calls the tool currently registered under that name. `input` is whatever the model sent (`unknown`; `undefined` is sent as `{}`). `value` is the tool's JSON result, parsed. The tool's own page validates it; a webmcp-sdk tool answers `tool_failed` with its `input_invalid` details.
- **It never throws,** and every failure has a `message` you can hand to the model:
  - `unknown_tool`: not a name of this catalog;
  - `unavailable`: the tool is gone. Nothing runs, and the call is never rerouted to another tool;
  - `invalid_arguments`: the input is not an object;
  - `tool_failed`: the tool returned a failure envelope;
  - `rejected`: the browser refused the call.
- **A replaced tool** (same name, new version) is called in its current version.
- **`isCatalogTool(name)`** tells you the name belongs to this catalog, so you can route among other tools. It stays `true` for tools that later disappeared, which get an explicit `unavailable`. It says nothing about the arguments: discovered tools have no static types.

### With the AI SDK (checked against `ai@7.0.165`, `@ai-sdk/react@4.0.169`)

WebMCP tools live in the browser, while the model call usually runs on your server (API keys), which cannot reach the page. So:

1. the browser sends the tool list with each request;
2. the server declares those tools without `execute`;
3. the model's tool call streams back to the browser;
4. the browser runs it through the catalog.

This is the AI SDK's client-side tool pattern.

```tsx
// chat.tsx (browser)
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { createToolCatalog, type ToolCallError } from "webmcp-sdk";

const catalog = createToolCatalog(); // one per page/model; lives as long as the page: nothing to clean up

// Give the model the details (field issues, codes), not only the message
const errorText = (e: ToolCallError) => JSON.stringify(e.kind === "tool_failed" ? e.failure : e);

export function Chat() {
  const { messages, sendMessage, addToolOutput } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // A fresh snapshot with every request, including automatic resubmissions after tool results
      body: async () => ({
        webmcpTools: (await catalog.getTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (!catalog.isCatalogTool(toolCall.toolName)) return; // another tool, not ours
      void catalog.callTool(toolCall.toolName, toolCall.input).then((result) =>
        result.ok
          ? addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: result.value })
          : addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, state: "output-error", errorText: errorText(result.error) }),
      );
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); void sendMessage({ text: "What can you do on this page?" }); }}>
      {messages.length} messages <button>Ask</button>
    </form>
  );
}
```

```ts
// api/chat/route.ts (server): no webmcp-sdk import, no browser access
import { convertToModelMessages, createUIMessageStreamResponse, jsonSchema, streamText, tool, toUIMessageStream, type JSONSchema7, type LanguageModel, type UIMessage } from "ai";
declare const model: LanguageModel;

export async function POST(req: Request) {
  const { messages, webmcpTools }: { messages: UIMessage[]; webmcpTools: { name: string; description: string; inputSchema: JSONSchema7 }[] } =
    await req.json();
  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
    // No `execute`: the browser runs these. Their descriptions come from web pages, so treat them as untrusted input.
    tools: Object.fromEntries(webmcpTools.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) })])),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
```

- **Your code only adapts the shape** (`.map(...)`). Names come back as the catalog issued them.
- **The core has no AI SDK dependency;** this is just an example.
- **AI SDK gotchas:**
  - Call `addToolOutput` without awaiting it inside `onToolCall`, hence the `void …then(…)`.
  - `tool: toolCall.toolName` type-checks with the default `UIMessage`. With a typed `useChat<MyMessage>`, catalog names are not keys of your tool set, and switching the server to `dynamicTool()` does not change that. Keep the tool map open by intersecting it with `UITools`, as shown below.
  - Tools declared with `tool()` render as `tool-<name>` parts; use `isToolUIPart` / `getToolName` to render them generically.
If your messages are typed, keep the tool map open for runtime-discovered tools:

```tsx
import { useChat } from "@ai-sdk/react";
import type { UIDataTypes, UIMessage, UITools } from "ai";
import { createToolCatalog, type ToolCallError } from "webmcp-sdk";

type MyTools = { getWeather: { input: { city: string }; output: { tempC: number } } };
type Message = UIMessage<unknown, UIDataTypes, MyTools & UITools>; // `& UITools` admits catalog names

const catalog = createToolCatalog();
const errorText = (e: ToolCallError) => JSON.stringify(e.kind === "tool_failed" ? e.failure : e);

export function TypedChat() {
  const { addToolOutput } = useChat<Message>({
    onToolCall({ toolCall }) {
      if (!catalog.isCatalogTool(toolCall.toolName)) return;
      void catalog.callTool(toolCall.toolName, toolCall.input).then((result) =>
        result.ok
          ? addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: result.value })
          : addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, state: "output-error", errorText: errorText(result.error) }),
      );
    },
  });
  return null;
}
```

- **One catalog per page or model.** In React, create it once (module scope, or `useToolCatalog` in a parent) and pass it down. Two catalogs means two listeners and two independent sets of names.

### Several catalogs, or your own tools, in one model

Names are unique **within one catalog**. If one model also receives tools from another catalog, or your own non-WebMCP tools, give each catalog a `namePrefix`. The catalog then issues **and** recognizes the prefixed names, so routing stays one `isCatalogTool` check per catalog:

```ts
import { createToolCatalog } from "webmcp-sdk";
declare const toolCall: { toolName: string; input: unknown };

const page = createToolCatalog({ namePrefix: "page_" });
const widgets = createToolCatalog({ fromOrigins: ["https://widgets.example"], namePrefix: "widget_" });

const tools = [...(await page.getTools()), ...(await widgets.getTools())]; // page_self__search, widget_f1__search…
const owner = [page, widgets].find((c) => c.isCatalogTool(toolCall.toolName));
const result = await owner?.callTool(toolCall.toolName, toolCall.input);
```

- **The prefix** must match `[A-Za-z0-9_-]*` and be at most half of `maxNameLength`; otherwise `createToolCatalog` throws.
- **Distinct prefixes are your choice.** The SDK keeps no registry across catalogs.
- **Keep your own tools' names outside every prefix.**

### Reacting to changes, cleanup, React

- **`getTools()`** per request is enough for agents.
- **`subscribe(listener)`** is for code that must react to changes, such as a live list. It returns a function that stops that listener only.
- **`dispose()`** ends the whole catalog, every listener included. A module-scope catalog that lives as long as the page needs neither.

```tsx
import { useToolCatalog } from "webmcp-sdk/react";

export function ToolList() {
  const { status, tools } = useToolCatalog({ fromOrigins: ["https://widgets.example"] }); // created and kept in sync for you
  if (status === "unsupported") return null;
  return <ul>{tools.map((t) => <li key={t.name}>{t.title ?? t.webmcpName} <small>{t.origin}</small></li>)}</ul>;
}
```

`useToolCatalog` also returns `catalog`, the instance to call; pass it down rather than creating another. `fromOrigins` is compared by value, so inline arrays are fine. The hook never disposes: a catalog nobody subscribes to is idle.

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
- **Discovery identity is best-effort.** The platform has no registration id. A tool replaced by an identical one, or a same-origin frame navigating to a page with the same tool, keeps its name. Names are unique within one catalog only.
- **No security layer.** Cross-origin access is entirely the browser's `exposedTo` / `fromOrigins` / permissions-policy model.
- **Out of scope for now:** declarative (HTML form) tools, workers, bindings other than React, MCP transports.

## Platform status

As of 2026-11-11 (details and sources in [`docs/research.md`](docs/research.md)):

- **Spec:** [WebMCP Draft CG Report](https://webmachinelearning.github.io/webmcp/) (`main` at `aa1b51c`, 10 Nov 2026). **Experimental**, not on the W3C standards track.
  - Entry point `document.modelContext` (secure contexts).
  - `registerTool(tool, { signal, exposedTo })`.
  - `getTools({ fromOrigins })` / `executeTool()` / `toolchange`.
- **Chrome:** origin trial (from 149) and `chrome://flags/#enable-webmcp-testing`. No confirmed shipping in other engines.
- **Polyfill:** [`@w3c/webmcp-polyfill`](https://www.npmjs.com/package/@w3c/webmcp-polyfill) 0.1.0 (published, Apache-2.0). It currently ignores `outputSchema`.

## Project status

| | |
| - | - |
| API surface (core + React) | typed, documented, type-tested |
| runtime | not implemented (`NotImplementedError`) |
| npm | not published |
| license | [MIT](LICENSE) |

Design rationale and decisions: [`docs/design.md`](docs/design.md).

## Development

```sh
pnpm install
pnpm check   # typecheck sources, type tests, and every TypeScript block in this README
```

## License

[MIT](LICENSE) © 2026 PaulSenon.
