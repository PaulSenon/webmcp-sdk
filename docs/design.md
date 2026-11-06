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

## Alternative 5: errors

- One agent-facing union, `ToolFailure`, keyed by `kind` = the boundary that failed (`input_invalid`, `execution_failed`, `output_invalid`, `cancelled`, `unavailable`). No class hierarchy.
- One author-facing class, `ToolError(message, { code, retryable, data, cause })`. Only its message crosses to the agent.
- One developer-facing class, `WebMCPError(code)`, for definitions and registration.
- **In-band delivery**, because the draft drops callback rejection messages (`OperationError`). The cost is a mismatch with `outputSchema`. This is open question #1 in the README.
- Typed per-contract error maps (oRPC `.errors()`) are deferred. They can be added later without breaking changes.

## Alternative 6: consumer identity

| option | verdict |
| ------ | ------- |
| name only | breaks with frames (same name in two documents) |
| name + window | breaks on same-origin navigation (WindowProxy survives) |
| **source document + name + descriptor fingerprint** ✅ | best the platform allows. Re-registration of an identical descriptor is indistinguishable, and that is documented |
| registration instance id | does not exist in the platform |

The `key` (LLM-facing unique name) is computed per snapshot and deliberately **not** identity. `bind(contract)` is name-based by design and validates both directions at runtime.

## What is deliberately not here

Middleware, plugins, a typed error map, toolset prefixes, MCP transports, declarative form tools, worker support. Each one can be added later without breaking the surface above.
