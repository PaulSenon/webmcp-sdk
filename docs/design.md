# Design notes

Status: design prototype, 2026-11-06. This file records **why** the API looks the way it does. Facts about the platform are in [`research.md`](research.md), with dates and sources.

> **Reading guide (2026-11-06).** The code, the type tests and the README still show **pass 1** (`contract → implement().handler → toolset.register()`). Decisions taken since then are recorded below and are **not implemented yet**. No API refactor or runtime work starts until every open point has been discussed with the user, one at a time.

## Decision status

### Decided

| # | decision | source |
| - | -------- | ------ |
| D1 | **Progressive enhancement.** Without WebMCP, registering never breaks the app: nothing is registered, a simple `"unsupported"` state, no automatic polyfill. Details in [Decision: progressive enhancement](#decision-progressive-enhancement-user-decision-2026-11-06). | user, 2026-11-06 |
| D2 | **Definition helpers, then implementation, then separate WebMCP registration.** Definitions and contracts are plain objects built by a helper (illustrative name `defineTool({...})`, no handler). `implementTool(definition, handler)` infers input/output from the definition. WebMCP registration (and the React binding) is a separate step that takes implementations. This replaces the chained `implement(c).handler()` and the `toolset.register()` method. | user, 2026-11-06 |
| D4 | **Context is a property of the implementation, never of the definition.** The definition stays the agent-facing contract, free of app-internal types (option S2 rejected). | user, 2026-11-09 |
| D5 | **No SDK context mechanism in v0: dependencies are passed by plain factories.** Handler stays `(input, { signal })` so a `context` property can be added later without breaking. | user, 2026-11-09 |
| D6 | **One factory per implementation, taught by docs and examples (no API enforcement).** A tool that needs data is a function of exactly that data (`applyFilterTool({ dashboard })`). Composition happens in the array at the registration site. A shared factory only forwards to per-tool factories. Factories topic closed. | user, 2026-11-10 |
| D7 | **A user declining a confirmation is a normal business result**, declared by the tool author in the tool's own output schema (`status: "declined"` is only an example; no status name is imposed). There is no SDK mechanism for it. The SDK validates that output like any other. | user, 2026-11-10 |
| D8 | **No validation-formatting hook in v0.** Input-validation failures use one fixed SDK format. A future hook, if a real case appears, must follow the constraints below. Details in [Validation formatting](#validation-formatting-d8). | design arbitration (Opus), 2026-11-10, after a question from the user |
| D3 | **No `defineToolset` unless it earns its place.** Applying the user's rule ("drop it if it is just an array"), the analysis below finds no real utility, so it is dropped. Registration takes a plain array of implementations. | user rule + analysis below |

**Why `defineToolset` is dropped (D3).** Candidate benefits, each checked:

- *Compile-time duplicate-name check.* It works the same on the registration parameter (`registerTools<const T extends readonly Impl[]>(tools: T & UniqueNames<T>)`), so no wrapper is needed.
- *Stable identity for React.* A module-level array is just as stable, and with D2 the React binding should key on definitions anyway, not on a wrapper.
- *Merged context typing.* Only relevant if context survives (open point O3). Even then, the merge can be computed on the registration parameter.
- *Group-level options (prefix, shared `exposedTo`).* None exist in v0. If one appears later, re-introduce a toolset **with** that justification.

So it would be pure ceremony today. Reversal criterion: a group-level option that must travel with the tools across call sites.

### Requirement (user, 2026-11-09)

**R1. Context is a real need.** A tool must be able to require page-side data (context) that its implementation reads. The developer must **not** be able to wire a tool where that data is missing (a compile-time guarantee). The agent never knows about or provides context: it is distinct from LLM arguments and never appears in any exposed schema. *Not decided:* where the requirement is declared (definition vs implementation), where it is provided (toolset, registration, per call), the exact syntax. The oRPC-style `.$context<T>()` builder stays rejected (D2).

### Proposed, awaiting discussion (in this order)

1. **Errors.** Full proposal in [Errors: proposal under discussion](#errors-proposal-under-discussion). In discussion since 2026-11-10. Declined confirmation is settled (D7). Next: SDK-generated errors vs errors the author transmits, then the `handlerCalled`/retry guarantees and the envelope.
2. **JSON Schema capability required at definition time** (vs only at WebMCP registration). Recommendation: at definition. Describing a tool to an LLM is intrinsic to a tool, and type errors stay next to the schema. WebMCP-only constraints (name charset, dialect, envelope, annotation mapping, serialization) move to the registration step.
3. **Context.** Superseded by the user requirement of 2026-11-09 (R1). Analysis in [Context: requirement and analysis](#context-requirement-and-analysis-2026-11-09). It can be discussed independently of the errors review.
4. **Generic execution layer.** Recommendation: validation and failure mapping live in a generic, browser-free executor (illustrative `runTool(impl, rawInput, { signal })`) used by the WebMCP binding. `implementTool` stays a pure typed handler, callable directly in tests.
5. **React binding details.** Recommendation: re-register only when the list of **definitions** changes (identity, element-wise) or options change. Handlers are refreshed in a ref after commit, and a call between render and commit sees the previous handler (documented). Dev warning on churn from inline definitions. Sub-choice: whole-set re-registration vs per-tool diff.
6. **Strict mode removal.** Recommendation: remove `ifUnsupported` entirely (see D1 section).
7. **Exact names.** `defineTool` (which may suggest a handler is included; `defineToolContract` is a candidate), `implementTool`, the registration function and hook names.

### Still open from pass 1

Typed error maps in contracts, toolset prefixes (now moot unless D3 is reversed), consumer packaging, and in-band envelope vs `outputSchema` (folded into the errors proposal).

## Errors: proposal under discussion

Goal (user): the SDK handles input/output validation and every failure in its own scope automatically, with no plumbing in handlers. What the agent gets must be clear and actionable, and must never promise a safe retry or the absence of side effects.

### What Standard Schema actually provides

`~standard.validate(value)` returns, sync **or** async, either `{ value }` (after transforms) or `{ issues: [{ message, path? }] }`. Nothing else is guaranteed:

- `path` is optional. It is a list of `PropertyKey` or `{ key }`. Root-level issues (e.g. a `.refine` without `path`) have none.
- `message` is free text from the schema library. It may *read* "expected X, received Y" (Zod), but there are **no** structured `expected`/`received`/`code` fields, and the SDK must not invent them.
- `validate` takes no `AbortSignal`. Async validation cannot be cancelled, only ignored.
- `validate` itself may **throw** (schema bug, an async refine hitting the network). That is not invalid input but an internal failure, and the handler was not called.
- Messages may be localized and are authored by the schema author. The SDK passes them through.

The SDK formats paths as readable strings (`items[0].sku`, with `"(root)"` when absent), caps the number of issues (e.g. 20, with an "N more" count), and never echoes the input back (the agent already has it).

### Validation formatting (D8)

**How Standard Schema unifies errors.** Whatever the library, a failed `validate` returns issues with a `message` and an optional `path`. The current signature is `validate(value, options?: { libraryOptions?: Record<string, unknown> })`, checked against `@standard-schema/spec@1.1.0` and standardschema.dev on 2026-11-10. The SDK can therefore format failures from any library itself, with no per-library adapter. `libraryOptions` is vendor-specific and has no standardized keys, so the SDK does not pass anything through it in v0.

**Decision: no formatting hook in v0.**

- **Messages are already customizable where they belong:** in the schema (`z.string().min(1, "…")`, Valibot or ArkType messages), per tool and per library.
- **Localization is library configuration** (for example Zod locales), not an SDK concern.
- **What the SDK owns is fixed and uniform:** readable paths (`items[0].sku`, `(root)`), a cap on the number of issues, and the "the tool did not run" framing. A hook would make that uniform part per-app variable for little gain.
- **The only real case found:** a schema shared between a UI form and a tool, whose UI-oriented messages (another language, end-user wording) are worse for the agent. It is weak, because LLMs read those messages fine. The workaround is a tool-specific schema or message.
- **Cost of a hook:** an option in core and React, ordering and failure semantics, tests, and documentation. That is surface without proven value.

**If a hook is ever added (non-breaking registration option), it must respect these constraints:**

- It may rewrite issue **messages and paths only**. It can never turn a failure into a success, drop the failure, or change `handlerCalled: false`.
- An empty result still reports `input_invalid`, with a generic issue.
- If it throws, the SDK falls back to the default format and reports the hook error through `onToolError`. The agent still receives `input_invalid`.
- **Scope is input only.** Output-validation issues are not sent to the agent under the current proposal (output validation is still to be discussed).

### Proposed taxonomy: five kinds, each mapped to an agent action

| kind | `handlerCalled` | what the agent is told |
| ---- | --------------- | ---------------------- |
| `input_invalid` | `false` | did not run; fix these fields (issues) and call again |
| `tool_error` | `true` | the author's `ToolError` message, `code`, `data` |
| `internal` | `true` or `false` | failed unexpectedly; if called: may have partially run, check state before retrying |
| `output_invalid` | `true` | ran, but its result failed validation; the action may have been performed; check state |
| `interrupted` | `true` | the tool was removed while running (unregister, unmount); may have partially run; re-discover |

Changes vs pass 1:

- `execution_failed` splits into `tool_error` and `internal`. The difference changes the agent's next step.
- `cancelled` is dropped. When the agent aborts, the browser has already rejected the caller and ignores late results, so an SDK value would be invisible.
- `unavailable` becomes `interrupted`.
- `retryable` is dropped. The SDK cannot know whether a retry is safe, and the author can say so in the message.
- `handlerCalled: boolean` is added. It is a fact the SDK knows exactly, not a promise about effects.

A non-serializable result falls under `output_invalid`. A failing validator falls under `internal` with `handlerCalled: false`. Out of scope: timeouts, concurrency, browser-level errors (`DataError`, `NotFoundError`, caller `AbortError`).

### Examples (proposed API names, illustrative)

```ts nocheck
// Input invalid: no handler code needed
// agent receives:
{ "isError": true, "error": { "kind": "input_invalid", "handlerCalled": false,
  "message": "Arguments rejected; the tool did not run. Fix the fields below and call again.",
  "issues": [{ "path": "quantity", "message": "Too small: expected number to be >=1" }] } }
```

```ts nocheck
// Business failure: the author throws ToolError
const reserveItem = implementTool(reserveItemDef, async (input) => {
  const left = await stock.available(input.sku);
  if (left < input.quantity)
    throw new ToolError(`Only ${left} left. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { left } });
  return { reserved: input.quantity };
});
// agent receives:
{ "isError": true, "error": { "kind": "tool_error", "handlerCalled": true,
  "code": "OUT_OF_STOCK", "message": "Only 2 left. Ask for at most 2.", "data": { "left": 2 } } }
// any other throw → { kind: "internal", handlerCalled: true, message: "The tool failed unexpectedly.
//   It may have partially run; check the current state before retrying." }  (original → dev hook only)
```

```ts nocheck
// User declines a confirmation: an outcome declared in the output, not an error (recommended option A)
const checkoutDef = defineTool({
  name: "checkout",
  description: "Place the order. The user is asked to confirm; if they decline, do not retry unless they ask.",
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("placed"), orderId: z.string() }),
    z.object({ status: z.literal("declined"), message: z.string() }),
  ]),
});
const checkout = implementTool(checkoutDef, async () => {
  if (!(await confirmDialog("Place order for 42 €?")))
    return { status: "declined", message: "The user declined. Do not retry unless they ask again." };
  return { status: "placed", orderId: await placeOrder() };
});
// agent receives a successful, schema-described result:
{ "status": "declined", "message": "The user declined. Do not retry unless they ask again." }
```

### Declined confirmation: two options (decided: A, see D7)

- **A. An outcome in the output union (recommended).** No SDK surface, just a documented pattern. The semantics are right: the call succeeded and the user said no. It is typed in the contract, described by `outputSchema`, and typed for `bindContract` consumers. WebMCP has no `requestUserInteraction` in the current draft, so the confirmation UI is the page's own code inside the handler anyway.
- **B. An SDK mechanism** (`return declined(...)` / `throw new ToolDeclined()`). It needs a third envelope shape, grows `outputSchema`, adds a concept, and the outcome is untyped in the contract. Revisit only if many tools repeat the same pattern. Even then, a tiny schema helper that builds the union would beat a new envelope.

### Envelope vs `outputSchema`

With declined outcomes in the output (A), the envelope carries only real failures. `{ isError: true, error }` remains, and tools with an `output` schema advertise `anyOf [output, envelope]`. The alternatives are worse: omitting `outputSchema` loses success typing, and rejecting loses the message to `OperationError`. Still to validate with agent implementers.

### Questions for the user (errors)

1. ~~Declined confirmation: A or B?~~ Decided: A (D7).
2. Drop `retryable`, add `handlerCalled`?
3. Minor, can default: readable path format, issue cap, the `interrupted` merge.

## Context: requirement and analysis (2026-11-09)

Status: **analysis, not decided.** All signatures are illustrative. Two type probes (TypeScript 7.0.2, strict, `exactOptionalPropertyTypes`) confirmed that every positive and negative case shown here type-checks as described. The probes used a minimal model of the helpers, not the repo API, and were deleted afterwards.

### Do closures and factories already give the guarantee?

Mostly yes. That is the honest baseline.

```ts nocheck
const dashboardTools = (dashboard: Dashboard) => [
  implementTool(applyFilter, (input) => ({ count: dashboard.apply(input.filter) })),
];
registerTools(dashboardTools(dashboard)); // forgetting `dashboard` is a compile error
```

A plain function parameter already makes "missing context" a compile error, handles async dependencies (pass a getter) and composes across heterogeneous tools (`[...cartTools(cart), ...userTools(user)]`). What factories **do not** give:

1. **Implementations defined once, at module scope**, that are not yet wired. Each instance re-creates them. That is harmless if bindings key on definitions, but the "tool value" and "its wiring" cannot be separated.
2. **One provision point with a merged, inspectable requirement.** The registration site cannot see "these tools need `{ dashboard, user }`". Each factory must be called by hand.
3. **Per-call resolution by the host.** A factory captures values when called, so freshness depends on re-calling it or on passing getters.

So an SDK context feature is **ergonomics plus a single checked wiring point**. It is not a capability that factories lack in principle. That is a sufficient reason only if it stays cheap. The proposal below adds no new helper.

### Where to declare the requirement

| | **S1. On the implementation** (handler's 2nd parameter) | **S2. On the definition** (`context: requires<T>()`) |
| - | - | - |
| syntax | `implementTool(def, (input, { dashboard }: { dashboard: Dashboard }) => …)` | `defineTool({ …, context: requires<{ dashboard: Dashboard }>() })`, then the handler's `(input, { dashboard })` is typed without annotation |
| new concept | none (a parameter annotation) | a type-marker value `requires<T>()` |
| definition stays agent-facing and shareable | yes | no: the shared contract imports app-internal types |
| mock/test implementation needing no context | natural | must still be fed the declared context |
| requirement visible next to the metadata | no (it is in the handler) | yes |
| probe | ✅ `Ctx` inferred from the annotation, `input`/output still inferred; no 2nd param ⇒ no requirement | ✅ handler context typed from the definition; an impl claiming another type is rejected |

**Recommendation: S1.** Context is an implementation dependency: a mock or a second implementation of the same definition may need none. The definition is the agent-facing contract that consumers and tests import, and it should not depend on app internals. S1 also adds no concept. The cost is an annotation in the handler and a placeholder when only `signal` is needed: `(input, _ctx, { signal })`. Offering both S1 and S2 is rejected because it creates two ways to do one thing. The user's intuition was S2, so this is the first point to discuss.

### Where to provide and resolve it

| option | verdict |
| ------ | ------- |
| **at registration** (`registerTools(tools, { context })`, React hook `{ context }`) ✅ | one wiring point, merged requirement checked there, no extra concept |
| a toolset that binds context (`defineToolSet({ tools, context })`) | adds a guarantee only if a *pre-bound* set must be registered from several places; otherwise it duplicates registration. Re-introduce `defineToolSet` only with that use case (D3 criterion) |
| injected per call by the host | this *is* the registration option's semantics: see resolution below |

**Resolution:**

- **Core:** `context: () => C | Promise<C>`, called **once at the start of each call**. Values are fresh, async lookups (a client, a token) are allowed, and a getter that throws gives `internal` with `handlerCalled: false` (errors proposal).
- **React:** `context` is a plain value from the **latest commit**, kept in a ref and read at call start. The handler gets that snapshot for the whole call. A long-running handler that needs live values after an `await` should put a getter or store in the context (`{ getFilters: () => … }`). No magic is promised.

### Cases

```ts nocheck
// module scope, usable with or without React
export const applyFilterTool = implementTool(applyFilter,
  (input, { dashboard }: { dashboard: Dashboard }) => ({ count: dashboard.apply(input.filter) }));
export const whoAmITool = implementTool(whoAmI, (_input, { user }: { user: User }) => user.name);
export const pingTool = implementTool(ping, () => "pong"); // no context

// React dashboard: values from the latest commit, read per call
function DashboardPanel({ dashboard, user }: Props) {
  useWebMCPTools([applyFilterTool, whoAmITool, pingTool], { context: { dashboard, user } });
}

// Outside React, async per-call dependency
registerTools([applyFilterTool], { context: async () => ({ dashboard: await loadDashboard() }) });

registerTools([pingTool]);                                         // ✅ nothing required
registerTools([applyFilterTool]);                                  // ❌ context missing
registerTools([applyFilterTool, whoAmITool], { context: () => ({ dashboard }) }); // ❌ `user` missing
registerTools([applyFilterTool, otherImplWhereDashboardIsANumber], …);          // ❌ incompatible `dashboard` types
```

- **Heterogeneous collections:** the requirement is the intersection of each tool's context. Pass-1 types already handle unions and callables, and erased `AnyTool[]` arrays fail closed. Incompatible same-named keys become `never` and are rejected, but the message is unreadable today. A dedicated "conflicting context key" error type is a follow-up. Convention: namespace keys (`dashboard`, `cart`, `user`).
- **Extra context where none is needed:** the probe rejects it (a likely wiring mistake). Lenient acceptance is the alternative. Minor, to decide.
- **Several instances of the same component:** context does **not** solve exposing two dashboards at once. WebMCP names are unique per document, so the second instance gets `duplicate_name` (React retries when the first leaves). Exposing several instances needs distinct names or an instance argument in `input`. That is an agent-facing design choice, not context.
- **Consumer:** calls with `input` only. `bindContract(definition)` and discovered tools never see context, because it is a separate handler parameter and is never part of `inputSchema`.

### Guarantees and non-guarantees

- **Compile-time:** a tool cannot be registered without a context that satisfies its requirement. This holds with tuples or `satisfies`. Erased element types fail closed.
- **Runtime:** context is trusted page-side data and is **not validated** by the SDK. If it contains external data (API responses), validate where that data enters the app.
- **Not authorization:** context carries page data (which may include the signed-in user's session), not a statement about the agent. The agent acts with the user's authority in the page. Handlers must enforce the app's own permission checks per call, and sensitive actions should use confirmation (`consequentialHint`, a declined outcome).

### Follow-up (2026-11-09): is an SDK context feature worth it at all?

D4 settles *where* context belongs. The remaining question is whether the SDK should have a context mechanism, or whether plain factories are the answer to R1. **Recommendation: factories in v0, no SDK context.**

- **R1 is satisfied by factories.** A required function parameter means a tool cannot be wired without its data. The agent never sees it, and it is never in a schema.
- **The React rule makes factories free.** `useWebMCPTools(dashboardTools(dashboard))` creates new implementations each render, but the binding keys on **definitions** and refreshes handlers after each commit (proposed point 5). Freshness is therefore identical to an SDK context option.
- **Outside React**, per-call freshness and async dependencies come from passing a getter: `dashboardTools(() => store.current)`.
- **The SDK feature would only add** module-level pre-declared implementations and a merged requirement at the registration site. The factory signature already *is* that requirement, written in plain TypeScript.
- **What the SDK feature would cost:** a handler parameter with special meaning, a `context` option in core and React, intersection typing with an unreadable conflict error, an extra failure path (getter throws), and documentation.
- **Forward compatibility:** keep the handler as `(input, { signal })`, with call info in an object, so a `context` property could be added later without breaking anyone.

Reversal criterion: a real case where the implementation must be defined at module scope and wired elsewhere, where a factory is clearly worse.

### Follow-up (2026-11-09): steering toward one factory per tool

User concern: with 20 tools, a developer may write one big factory that returns all the implementations and closes over shared scope. Tools are then no longer isolated, and their dependencies are hidden, which makes them hard to move.

**Recommended convention (documentation and examples, no new API):**

```ts nocheck
// one export per tool; a tool that needs data is a function of exactly that data
export const applyFilterTool = ({ dashboard }: { dashboard: Dashboard }) =>
  implementTool(applyFilter, (input) => ({ count: dashboard.apply(input.filter) }));
export const pingTool = implementTool(ping, () => "pong"); // no deps: a plain value

// compose at the registration site; no global factory needed
useWebMCPTools([applyFilterTool({ dashboard }), resetTool({ dashboard }), pingTool]);
```

Why no API enforcement:

- No API can prevent closure capture.
- Enforcing declared per-tool dependencies would mean re-introducing the SDK context mechanism rejected in D5, and it still would not stop a big closure.

The leverage instead comes from three places:

1. **Make the good path the shortest.** Every README example uses one export per tool, with dependencies as an explicit parameter object, composed in the array at the call site.
2. **Make composition safe.** A duplicate name across a composed array is a compile error, and a missing dependency is a compile error at `applyFilterTool({ … })`.
3. **Make testing obvious:** `applyFilterTool({ dashboard: fake })`.

A shared factory is only for reusing the same set in several places, and it should just forward to the per-tool factories.

### Questions for the user (context)

1. ~~S1 (implementation) or S2 (definition)?~~ Decided: implementation (D4).
1b. ~~SDK context mechanism, or factories only?~~ Decided: factories (D5).
1c. ~~Per-tool factory convention via docs/examples only?~~ Decided (D6). Topic closed.
2. **Provide at registration**, with no `defineToolSet`, unless a real "pre-bound set registered from several places" case exists?
3. Minor: reject or accept extra context; the placeholder `_ctx` when only `signal` is needed (vs an options object).

## Principles

1. **Final API first.** The surface is written as if the runtime existed. Layers below it (validation pipeline, schema resolution, model-context adapter) exist only to serve it.
2. **Contract → implementation → toolset → registration.** Each step adds one concern: *what*, *how*, *which together*, *where and when*.
3. **Standard Schema first, no Zod lock-in.** The core depends only on `@standard-schema/spec` types.
4. **Compile-time types ≠ runtime truth.** Types describe validated values. Validation runs on every call.
5. **Never fake success.** Stubs throw `NotImplementedError`. At runtime, a cancelled-but-completed handler returns its real result, and stale refs never reroute.
6. **Core is small.** React and the consumer layer are separate entry points that the core does not import.

## Alternative 1: how to define a tool

> Superseded by D2 (helpers + separate registration). Kept as history.

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

> Pass-1 history. Superseded by R1 and [Context: requirement and analysis](#context-requirement-and-analysis-2026-11-09).

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

> Pass-1 design. Superseded by [Errors: proposal under discussion](#errors-proposal-under-discussion) once validated.

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

5. **Definition API shape:** decided, see D2/D3 in [Decision status](#decision-status).

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
