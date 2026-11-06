# Design notes

Status: design prototype, 2026-11-06. This file records **why** the API looks the way it does. Facts about the platform are in [`research.md`](research.md), with dates and sources.

## Principles

1. **Final API first.** The surface is written as if the runtime existed. Layers below it (validation pipeline, schema resolution, model-context adapter) exist only to serve it.
2. **Contract → implementation → toolset → registration.** Each step adds one concern: *what*, *how*, *which together*, *where and when*.
3. **Standard Schema first, no Zod lock-in.** The core depends only on `@standard-schema/spec` types.
4. **Compile-time types ≠ runtime truth.** Types describe validated values. Validation runs on every call.
5. **Never fake success.** Stubs throw `NotImplementedError`. At runtime, a cancelled-but-completed handler returns its real result, and stale refs never reroute.
6. **Core is small.** React and the consumer layer are separate entry points that the core does not import.

## Alternative 1: how to define a tool

Three shapes were compared on the same tool.

**A. One options object, handler inside** (TanStack `queryOptions` style)

```ts nocheck
const addToCart = defineTool({
  name: "add_to_cart",
  description: "Add a product by SKU.",
  input: z.object({ sku: z.string() }),
  handler: async ({ input }) => ({ ok: true }),
});
```

This is the most compact form. It does not separate contract from implementation, so the contract cannot be shared without dragging the handler along. Context typing needs an explicit generic or an annotated parameter.

**B. Contract object + `implement(contract).handler()`** ✅ chosen

```ts
import { z } from "zod";
import { contract, implement, tool } from "webmcp-sdk";

const addToCart = contract({
  name: "add_to_cart",
  description: "Add a product by SKU.",
  input: z.object({ sku: z.string() }),
});
const impl = implement(addToCart).handler(async ({ input }) => ({ ok: true, sku: input.sku }));

// inline shorthand, same thing:
const inline = tool({ name: "ping", description: "Ping." }).handler(() => "pong");
```

Metadata stays a readable object literal. The contract is a value you can export. The single builder step (`$context<T>()`, then `.handler()`) gives clean context typing with no explicit generics. `tool()` keeps the happy path one expression.

**C. Fully chained builder** (oRPC `oc` style)

```ts nocheck
const addToCart = oc.name("add_to_cart").description("…").input(z.object({ sku: z.string() }));
```

It reads well for oRPC users, but most tools are 4–6 fields of metadata, which an object literal shows at a glance. Chains also make optional fields harder to scan and to diff. Rejected.

## Alternative 2: where context comes from

| option | verdict |
| ------ | ------- |
| closures only | simplest, and still fully supported (handlers just don't declare context) |
| **`$context<T>()` declared on the implementation, supplied at `register({ context })`** ✅ | needed when the same tool is mounted against different instances (per widget, per React subtree, tests) |
| per-call middleware chain (oRPC `.use`) | real use cases for WebMCP tools are thin; deferred |

`register({ context })` takes a **function**, resolved once per call. This removes the stale-value problem by construction and allows async lookups. The React bindings take a plain value and keep it in a ref.

## Alternative 3: schemas and JSON Schema

| option | verdict |
| ------ | ------- |
| accept any Standard Schema, convert "somehow" (Zod/Valibot sniffing) | hides failures, couples the core to vendors |
| a pluggable `jsonSchemaConverter` option at registration | works, but moves a per-schema fact into global config |
| **require `StandardJSONSchemaV1` at compile time + `withJsonSchema()` escape hatch** ✅ | one rule, no vendor code in the core, failures are explicit |

- Advertised schemas: the input side of `input`, the output side of `output`. The handler sees the opposite sides (see README table).
- Conversion runs at `register()` (and in `contract.toJSONSchema()` for tests). A failure is `WebMCPError("json_schema_unavailable")` before anything registers. The SDK never falls back to `{}`.
- Target dialect: `draft-2020-12` (the dialect the WebMCP draft references), configurable.

## Alternative 4: registration lifetime

The platform gives `registerTool(): Promise<undefined>` plus an `AbortSignal` (no handle, no `unregisterTool`). The SDK offers both idioms:

- `await toolset.register(options)` → `ToolsetRegistration` with sync, idempotent `unregister()`;
- `register({ signal })`, which also cancels a registration that is still pending.

Rejected: sync `register()` returning a handle with a `ready` promise. It looks simpler, but it invites unhandled rejections and hides the platform's async nature.

Invariants: **all or nothing** per toolset, **a FIFO queue per (model context, name)** for SDK-issued registrations, and no takeover of names owned by other code.

## Decision: progressive enhancement (user decision, 2026-11-06)

**Decided.** Loading the SDK and registering tools must never break the app in a browser without WebMCP. Concretely:

- If `document.modelContext` is absent (unsupported browser, insecure context, SSR), registration registers nothing, does not throw, and reports a simple `"unsupported"` state. In React, the hooks report the same state and never throw during render.
- Importing the SDK has no side effects and touches no browser globals at module load.
- No polyfill is installed automatically. Using `@w3c/webmcp-polyfill` stays an explicit choice of the app (`modelContext` option, or the app installs it itself).
- A light warning (for example a one-time dev-only `console.info`) is **not decided**. If it is added, it must be silenceable and must never be an error.

This is not fake success. Nothing claims to be registered, and the state says so.

**Not a requirement: the strict mode.** The `ifUnsupported: "throw"` option in the current types was a design suggestion, not a user request. Assessment: it does not earn its surface. An app that really requires WebMCP can write the check itself in one line (`if (reg.state === "unsupported") throw …`). The option adds a second behaviour to document and test in core and in React for a rare case. **Recommendation:** remove `ifUnsupported` in the next API pass and keep a single behaviour. It stays in the types for now, since this pass changes no API while the helpers-vs-builder discussion is open. `WebMCPError("unsupported")` would then go too.

Other errors are unaffected. A genuine registration failure in a browser that *does* support WebMCP (duplicate name, schema conversion, permissions policy) is still reported (`WebMCPError`, or React `state: "error"`), because there the developer's intent failed.

## Alternative 5: errors

- One agent-facing union, `ToolFailure`, keyed by `kind` = the boundary that failed (`input_invalid`, `execution_failed`, `output_invalid`, `cancelled`, `unavailable`). No class hierarchy.
- One author-facing class, `ToolError(message, { code, retryable, data, cause })`. Only its message crosses to the agent.
- One developer-facing class, `WebMCPError(code)`, for definitions and registration.
- **In-band delivery**, because the draft drops callback rejection messages (`OperationError`). The envelope is `{ isError: true, error: ToolFailure }`, with a discriminator so consumers do not guess from shape alone. Tools with an `output` schema advertise `anyOf [output, envelope]` so that strict agents do not reject failures as malformed. This is open question #1 in the README.
- A failing `context()` getter is `execution_failed` / `context_unavailable`. `unavailable` is reserved for "this registration ended during the call".
- Typed per-contract error maps (oRPC `.errors()`) are deferred. They can be added later without breaking changes.

## Alternative 6: consumer identity

| option | verdict |
| ------ | ------- |
| name only | breaks with frames (same name in two documents) |
| name + window | misses same-origin navigation (the WindowProxy survives) |
| **observed source + name + descriptor fingerprint** ✅ | the most the platform allows |
| registration instance id | does not exist in the platform |

The guarantees are layered, and the README and source say exactly this:

1. **SDK guarantee:** an `id` is never remapped to a different descriptor or observed source. A mismatch returns `stale` and `executeTool` is not called.
2. **Best-effort detection:** same-origin navigation is detected (`Document` identity). Cross-origin navigation is detected only through origin or descriptor changes. Identical re-registration is invisible.
3. **Platform limit:** `executeTool` resolves by name, so check-then-call is not atomic. Changes not yet observed can slip in. The browser still enforces origin and exposure.

`uniqueName` (the LLM-facing name) is computed per snapshot and is deliberately **not** identity. `bindContract(contract)` is name-based by design and validates both directions at runtime. The catalog follows React's external-store contract (no immediate emit). Svelte and Vue need a one-line adapter.

## Recommendations on open questions

1. **Failure envelope:** keep the in-band envelope with `isError: true` and `anyOf` advertising, then revisit with feedback from agent implementers. Omitting `outputSchema` would lose useful typing for successful results.
2. **Typed error maps:** defer. The `ToolError` code covers agents. Typed maps mostly help `bindContract` consumers and can be added without breaking anything.
3. **Prefixes:** defer. Duplicate names fail loudly, React retries when the owner leaves, and prefixes can be added as a toolset option later.
4. **Consumer packaging:** ship as `webmcp-sdk/consumer`, marked experimental, with its own stability notice. Move it to a separate package if the draft's discovery API changes shape.

5. **Under discussion (not decided): definition API shape.** The alternative under review is pure helpers (`defineTool` / `implementTool` / optional `defineToolset`) plus an explicit WebMCP binding (`registerTools`, React hook), instead of `contract → implement().handler → toolset.register()`. The progressive-enhancement decision above holds in both shapes.

## Review log

The first pass was reviewed by Claude Sonnet 5.5 (DX) and GPT-6.1 Sol at xhigh (type soundness, with compiler-verified repros). Changes applied:

- **Types:**
  - Nested `contract()` names stay literal, and empty names are rejected everywhere (`NoInfer` + separate validation).
  - The input constraint is now `object` plus a guard: interfaces are accepted; `any`, `never`, arrays, functions and `Date` are rejected.
  - Context merging keeps unions and call signatures (function-intersection), and erased `AnyToolImplementation[]` fails closed.
  - Optional input schemas infer correctly (distributive helpers).
  - Union and template names report potential duplicates regardless of order.
  - Handlers without an `output` schema return `JsonValue | void`.
- **DX and naming:**
  - `ifUnsupported` now defaults to `"skip"`, and React returns `{ state, error }` with the full option set. (Superseded: see "Decision: progressive enhancement". The option itself is slated for removal.)
  - React re-registers on tool-list changes, not wrapper identity, and retries `duplicate_name` automatically.
  - Renames:
    - `WebMCPTools` → `RegisterToolset`
    - `ToolCall` → `ToolHandlerArgs`
    - `onError` → `onToolError`
    - `ToolFailureResult` → `ToolFailureEnvelope`
    - consumer `ref`/`key` → `id`/`uniqueName`
    - `bind` → `bindContract`
    - `kind: "tool"` → `"tool_failed"`
  - `catalog.call(ref)` was removed, since `tool.call()` suffices.
  - Consumer-only platform types moved out of core.
- **Rejected:**
  - A global `setDefaults()` (hidden shared state).
  - `implementation.register()` (`toolset([t]).register()` is one line).
  - Renaming `WebMCPError` (it covers definition and environment errors, not only registration).
  - Renaming the `/consumer` subpath.

## What is deliberately not here

Middleware, plugins, a typed error map, toolset prefixes, MCP transports, declarative form tools, worker support. Each one can be added later without breaking the surface above.
