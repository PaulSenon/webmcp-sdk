# Design notes

Status: design prototype, 2026-11-06. This file records **why** the API looks the way it does. Facts about the platform are in [`research.md`](research.md), with dates and sources.

> **Reading guide (updated 2026-11-10, pass 2).** The sources, type tests and README now implement the decisions below as types plus `NotImplementedError` stubs. Sections marked as pass-1 history are kept for rationale only. The [Pass 2 surface](#pass-2-surface) section maps each decision to the API.

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
| D8 | **No validation-formatting hook in v0.** Input-validation failures use one fixed SDK format. A future hook, if a real case appears, must follow the constraints below. Details in [Validation formatting](#validation-formatting-d8). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D9 | **Output schema is optional. When declared, the SDK always validates the output, with no off flag.** Without one, the SDK only enforces JSON serializability. `output_invalid` means "ran, result withheld", not "execution failed". Details in [Output validation](#output-validation-d9). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D10 | **Author-transmitted failures are thrown as `ToolError` (or a subclass), recognized by a brand, with a field whitelist: `message` required, `code` and `data` optional.** Every other throw is a defect: the agent gets a generic message, the details go to the developer hook. No Result return type. Details in [Handler errors](#handler-errors-d10). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D11 | **React: one registration per tool, keyed by definition identity.** When the list changes, only added or removed tools are registered or unregistered. Unchanged tools are never touched. There is no group re-registration and no group rollback. Details in [React list changes](#react-list-changes-d11). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D12 | **Framework-agnostic core with one registration primitive: `registerTools(tools)` returns a `ToolRegistration` handle with `update(tools)` (explicit reconcile), `unregister()`, `subscribe`/`getSnapshot` and `settled()`.** Tools are matched by definition identity, never by array identity, and the core never observes mutations. Framework bindings only call `update`/`unregister` from their own effect system. Details in [Core registration and bindings](#core-registration-and-bindings-d12). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D13 | **Consumer ids: one stable string per (source, name), always prefixed from the start: `<sourceKey>__<name>`.** `sourceKey` is `self`, or `f<n>` assigned once per source (WindowProxy + origin) and never reused. Re-registering under the same name in the same source keeps the id. A separate `revision` lets snapshot-bound calls refuse a changed descriptor. Discovery API stays close to native (`getTools({ fromOrigins })` + change subscription + `call`). Replaces the pass-1 consumer identity model. Details in [Consumer ids and discovery](#consumer-ids-and-discovery-d13). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D14 | **Schemas: the SDK requires both Standard Schema capabilities from entry (`defineTool`): validation (`~standard.validate`) and JSON Schema conversion (`~standard.jsonSchema`).** Libraries plug in through the standard interface, with a documented adapter where conversion is not native (e.g. Valibot `toStandardJsonSchema`). The SDK keeps the **original validator** and runs it through the Standard Schema API. It **never rebuilds a validator from JSON Schema**: JSON Schema is only for description and protocol transfer. | validated by the user, 2026-11-10 (arbitration: Opus) |
| D15 | **Consumer lifecycle: a lazy, framework-agnostic catalog (core) plus `useTools({ fromOrigins })` (React).** The core owns discovery, the `toolchange` subscription, origin updates, race handling and identities. React only orchestrates lifecycle and reactivity. Source keys come from a **page-wide** identity table, so ids are identical across catalogs and survive remounts. Details in [Consumer lifecycle and React](#consumer-lifecycle-and-react-d15). | validated by the user, 2026-11-10 (arbitration: Opus) |
| D16 | **Removing a tool's availability is not cancelling its calls.** Unregistering or replacing a tool removes it for future calls only. A running call keeps the definition and handler it started with and is **not** aborted by the SDK. The handler's `signal` is exactly the native execution signal (caller cancelled, caller unloaded). A handler that depends on a destroyed component handles that through its own lifecycle. No stop or rollback is ever guaranteed. There is no `interrupted` kind. Details in [Unregister vs running calls](#unregister-vs-running-calls-d16). | design arbitration (Opus), 2026-11-10. The user questioned this, he did not decide it (correction of an earlier note) |
| D17 | **No `revision`/`stale` in v0.** A tool absent at call time returns `not_found` (nothing executed). A tool replaced before the call is **called in its current version** if the arguments pass its current schema; otherwise it returns `input_invalid`. This is intended semantics. Ids stay `<sourceKey>__<name>`. | user, 2026-11-10 |
| D18 | **Envelope details.** Success is sent as-is. Failure is `{ isError: true, error: { kind, message, handlerCalled, … } }`, with kind-specific `issues` (at most 20, plus `omittedIssues`) or `code`/`data`. There is no `retryable`. `outputSchema` is advertised as `anyOf [output, envelope]` when an output is declared, none otherwise. `isToolFailureEnvelope` requires `isError === true`, a known `kind` and a string `message`. **No schema restriction:** an output whose successful values look exactly like an envelope is documented as an ambiguity rather than forbidden (the earlier idea of rejecting a root `isError` property was dropped as too blunt). | the user agreed in principle; details are Opus's arbitration, 2026-11-10 |
| D3 | **No `defineToolset` unless it earns its place.** Applying the user's rule ("drop it if it is just an array"), the analysis below finds no real utility, so it is dropped. Registration takes a plain array of implementations. | user rule + analysis below |

**Why `defineToolset` is dropped (D3).** Candidate benefits, each checked:

- *Compile-time duplicate-name check.* It works the same on the registration parameter (`registerTools<const T extends readonly Impl[]>(tools: T & UniqueNames<T>)`), so no wrapper is needed.
- *Stable identity for React.* A module-level array is just as stable, and with D2 the React binding should key on definitions anyway, not on a wrapper.
- *Merged context typing.* Only relevant if context survives (open point O3). Even then, the merge can be computed on the registration parameter.
- *Group-level options (prefix, shared `exposedTo`).* None exist in v0. If one appears later, re-introduce a toolset **with** that justification.

So it would be pure ceremony today. Reversal criterion: a group-level option that must travel with the tools across call sites.

### Requirement (user, 2026-11-09)

**R1. Context is a real need.** A tool must be able to require page-side data (context) that its implementation reads. The developer must **not** be able to wire a tool where that data is missing (a compile-time guarantee). The agent never knows about or provides context: it is distinct from LLM arguments and never appears in any exposed schema. *Not decided:* where the requirement is declared (definition vs implementation), where it is provided (toolset, registration, per call), the exact syntax. The oRPC-style `.$context<T>()` builder stays rejected (D2).

### Remaining arbitrations

All review points are closed (2026-11-10). Names validated: `defineTool`, `implementTool`, `registerTools`, `createToolCatalog`, `useRegisterTools`, `useToolCatalog`, plus `<RegisterTools>` (the component form required by the original brief). Only the **license** remains, and it must be chosen before any publication.

## Pass 2 surface

| decision | where in the API |
| -------- | ---------------- |
| D2, D3, D14 | `defineTool` (`src/define.ts`) → `implementTool(definition, handler)` (`src/implement.ts`). No toolset. Schemas must be `StandardSchemaV1 & StandardJSONSchemaV1` |
| D5, D6 | the handler is `(input, { signal })`; dependencies come from per-implementation factories (README "Dependencies") |
| D7 | declined outcomes are ordinary outputs (README "Outcomes are outputs") |
| D8 | no formatting option anywhere |
| D9 | optional `output`, always validated; `JsonValue | void` without one |
| D10, D18 | `ToolError`, `isToolError`, `ToolFailure`, `ToolFailureEnvelope`, `isToolFailureEnvelope` (`src/errors.ts`) |
| D1, D11, D12, D16 | `registerTools` → `ToolRegistration` (`update`, `unregister`, `getSnapshot`, `subscribe`, `settled`) in `src/register.ts`. No throw; per-tool states; running calls never cancelled |
| D13, D15, D17 | `createToolCatalog` → `ToolCatalog` (`getTools`, `subscribe`, `update`, `call`, `find`, `dispose`), `toProviderName` in `src/catalog.ts`. Ids `<source>__<name>`, `not_found`, no revision |
| React | `useRegisterTools`, `<RegisterTools>`, `useToolCatalog` (`src/react/index.ts`) |
| testing | `runTool` (exported executor), `toJSONSchema` |

**Type-level finding during pass 2.** With `handler: ToolHandler<D>`, TypeScript 7 widened literal returns (`z.enum`, discriminated unions) because it checks the handler's return before resolving `D`. That forced `as const` in handlers. The fix is `handler: NoInfer<ToolHandler<D>>`: `D` comes from the definition only, so literals are kept and wrong returns are still rejected. Regression tests are in `type-tests/define.test-d.ts`. The alternatives were probed and rejected:

- `ToolHandler<NoInfer<D>>`: literals still widened.
- A separate return type parameter `R extends Out`: literals still widened.
- `const R`: forces readonly arrays.
- A phantom with `Out` inferred from both arguments: accepted outputs with missing fields.

### Resume point after the review (done: pass 2, 2026-11-10)

The agreed next pass, now executed:

1. **Types/interfaces** for the whole surface (core publisher, core consumer, React publisher and consumer hooks), with TODO implementations that throw `NotImplementedError`. Type tests: positive and negative.
2. **README rewritten as general library documentation**, not a design report. It covers plain TypeScript **and** the React bindings, with compiling examples checked by `pnpm check`, and DX reviewed.
3. **React is the only binding** in this pass. The core stays framework-agnostic, and other frameworks come later.

No runtime implementation until that pass is reviewed.

## React list changes (D11)

Settled so far: the hook takes an array of implementations. It registers on mount, refreshes handlers on re-render without re-registering when the definitions are the same, and cleans up on unmount. The question was what happens when the list changes: re-register the group, or diff per tool. The user asked for the simplest option.

**Decision: per-tool registration, keyed by definition identity.** This is the simplest robust option, not an extra layer. WebMCP's primitive is already one `registerTool` per tool, each with its own `AbortSignal`. Group atomicity (rollback when one tool fails) is the extra machinery. The hook keeps a map from definition to its controller and its latest handler. A list change is a set difference, applied in one effect after commit: abort the removed tools first, then register the added ones.

**Observable effects:**

| situation | what happens |
| --------- | ------------ |
| re-render, same definitions (implementation objects recreated, D6) | nothing is registered or unregistered; handlers refreshed after commit |
| a tool is added or removed | only that tool is registered or unregistered; unchanged tools never disappear and cause no notification from the SDK |
| same name, new definition object (e.g. schema changed) | old one aborted, new one registered; the per-name queue orders them; a short gap **for that tool only**, which is correct because its descriptor changed |
| a call in flight on an unchanged tool | unaffected; the call keeps the handler it started with |
| a call in flight on a removed tool | not aborted; it finishes with its captured definition and handler (D16) |
| one tool fails to register (e.g. `duplicate_name`) | the others stay registered; the hook reports the error naming that tool; no rollback |
| StrictMode mount → cleanup → mount | everything aborted, then registered again; the per-name queue prevents a spurious `duplicate_name` (dev only) |
| `enabled: false` / unmount | all tools of this hook are unregistered |
| the same definition twice, or two definitions with one name, in a list | compile-time error for literal names; at runtime the second is reported as a duplicate |

**Rejected: group re-registration on any change.** It is no simpler to write, but its effects are worse: unchanged tools vanish briefly, and every list change produces notifications for tools that did not change.

Scope: D12 moves this logic into the framework-agnostic core. The React binding only calls `update()`, so per-tool semantics now apply everywhere.

## Core registration and bindings (D12)

**Direction (user):** a TanStack-style architecture. The TypeScript core is framework-agnostic, with thin bindings per framework and React first. React's model must not dictate the core. The goal is *structural* simplicity, not the shortest algorithm.

**Options compared:**

| option | verdict |
| ------ | ------- |
| core = only `registerTool(impl)` per tool; bindings diff themselves | each binding re-implements reconciliation, handler refresh and the per-name queue: duplicated, subtle logic |
| core observes the array (Proxy, deep watch, mutation tracking) | ❌ magic and fragile; it ties the core to a reactivity model; explicitly not wanted |
| core registry with `add`/`remove`/`set` methods | three ways to change one thing |
| **core handle with one explicit `update(tools)` (declare the desired list; the core reconciles)** ✅ | one concept. The core owns the diff, handler refresh, per-name queue and per-tool errors. Bindings just call it. This mirrors TanStack's observer `setOptions` |

**Contract:**

```ts nocheck
const reg = registerTools(tools, { signal?, modelContext?, exposedTo? }); // sync handle; registration starts
reg.update(tools);      // reconcile against the new desired list
reg.unregister();       // abort everything; idempotent (same as aborting `signal`)
reg.getSnapshot();      // { tools: [{ name, definition, state: "pending" | "registered" | "unsupported" | "error", error? }] }
reg.subscribe(listener) // React external-store contract (no immediate emit); returns unsubscribe
await reg.settled();    // resolves when the current desired list is reconciled; never rejects (errors are in the snapshot)
```

**Reconciliation rules (`update`):**

- **The match is by definition identity**, element by element. An array's identity is meaningless: a new array holding the same definitions is a no-op apart from refreshing handlers, and re-passing a mutated array works the same way.
- **Kept definitions** get their handler replaced by the one in the new implementation (calls already in flight keep theirs) and are not re-registered.
- **Removed definitions** are aborted first, then **added** ones are registered, with the per-name queue ordering same-name replacements.
- **Per-tool outcome, no group rollback** (consistent with D11). A failure is visible in the snapshot for that tool only.
- **`update` copies the list.** Mutating the array afterwards without calling `update` again changes nothing. There is no hidden observation.
- **Progressive enhancement (D1):** without WebMCP, every tool's state is `"unsupported"`, nothing throws, and `update` stays a cheap no-op.

**Synchronous handle, async work.** This replaces pass 1's `await toolset.register()`. It fits effects (no promise inside cleanup), and `settled()` never rejects, which avoids the unhandled-rejection problem that ruled out "sync handle + `ready` promise" in pass 1.

**Independent lifetimes need no extra API:** use separate registrations. A "registration of one" is the individual registration.

**Plain TypeScript:**

```ts nocheck
const reg = registerTools([searchTool, pingTool]);

// cart became non-empty: declare the new desired list
reg.update([searchTool, pingTool, checkoutTool({ cart })]);
// fresh data for the same definition: handler refreshed, no re-registration, no notification
reg.update([searchTool, pingTool, checkoutTool({ cart: nextCart })]);

await reg.settled();
for (const t of reg.getSnapshot().tools) if (t.state === "error") console.warn(t.name, t.error);

// a separate lifetime: just another registration
const debug = registerTools([debugTool], { signal: devtools.signal });
reg.unregister();
```

**React binding (the whole job):**

```tsx nocheck
function useWebMCPTools(tools: readonly AnyImpl[], options?: Options) {
  const [reg, setReg] = useState<ToolRegistration | null>(null);
  useEffect(() => {                                   // create once per mount (StrictMode: create → unregister → create)
    const r = registerTools([], options); setReg(r); return () => r.unregister();
  }, [options?.modelContext]);
  useEffect(() => { reg?.update(tools); });          // after every commit: reconcile (cheap no-op when definitions are unchanged)
  return useSyncExternalStore(reg?.subscribe ?? noop, reg?.getSnapshot ?? idleSnapshot, idleSnapshot);
}
// usage
useWebMCPTools([applyFilterTool({ dashboard }), pingTool]);
```

This sketch shows the boundary, not final code. Options handling and the empty first snapshot stay to be refined.

**Other frameworks (feasibility only, not built now):** each binding is "call `update` in your effect, `unregister` on dispose, read status via `subscribe`":

- **Vue:** `watchEffect(() => reg.update(toValue(tools)))` plus `onScopeDispose(reg.unregister)`.
- **Svelte 5:** `$effect(() => reg.update(tools))`, with teardown in the effect's return.
- **Solid:** `createEffect(() => reg.update(tools()))` plus `onCleanup`.
- **Angular:** `effect(() => reg.update(tools()))` plus `DestroyRef`.

**Boundary:**

- **Core:** definitions, implementations, validation and execution, reconciliation, per-name queue, status store.
- **Bindings:** when to call `update`/`unregister`, and how to expose the status reactively.
- Nothing framework-specific lives in core.

## Consumer ids and discovery (D13)

**User need:** tools with the same name may come from different origins, or from different windows of the same origin. The agent side needs a **unique, stable string id**, so it can map tools to an agent framework without object references. That id is separate from the duplicable original `title`/`name`. Counter-example to avoid: A.`toto` and B.`toto` both unregister, then register again in reverse order. A first-come-keeps-the-name strategy would hand A's old id to B.

**What the platform actually provides** (draft 9 Nov 2026, checked 2026-11-10; see research addendum):

- `RegisteredTool` has `name`, `title`, `description`, schemas, `annotations`, **`window`** ("the Window of the document that registered the tool") and **`origin`**. There is **no registration id or generation**. The spec itself tells callers to inspect `origin` and `window` to tell same-named tools apart.
- `executeTool(tool)` resolves `tool.window` to its document, rejects `NotFoundError` if the origin no longer matches, then looks the tool up **by name**. The spec states that a quick unregister plus re-register under the same name "is *not* protected against" (issue #92).
- *Inference, not verified:* JavaScript code receives the `window` member as a **WindowProxy** (WebIDL/HTML convention), which survives navigation of that browsing context. After a **same-origin** navigation, an old `RegisteredTool` could therefore reach the new document's same-named tool. After a cross-origin navigation, it would hit the origin check.
- `toolchange` carries no payload and its timing relative to other tasks is not guaranteed. Discovery results are sorted by name.

So "name + origin + window" is the native disambiguation, but **not** a native identity guarantee. The SDK must not claim more.

**Algorithm (decided):**

- **Source = (WindowProxy, origin).** Each new pair gets a `sourceKey`: `self` for the catalog's own document, `f1`, `f2`… for others, from one monotonic counter per catalog. The counter is per source, not per name, and **never reused**. The keys are kept in a `WeakMap<WindowProxy, …>`, so a removed frame frees its entry.
  - **Origin change** for the same window means a new source key, so an id is never carried across sites.
  - **Same-origin navigation** keeps the source key. The SDK deliberately does not use `Document` identity, which is only visible for same-origin frames. One uniform rule beats a best-effort split, and the `revision` check below covers descriptor changes.
- **`id = sourceKey + "__" + name`**, always prefixed, never only on collision. It is injective: source keys never contain `__`, so the first `__` splits unambiguously, even for names that already contain `__` or look like `f1__x`.
  - **The counter-example cannot happen:** A's `toto` is always `f1__toto` and B's is always `f2__toto`, whatever the registration order.
  - **Re-registration** under the same name in the same source keeps the same id. That is the "same tool" the user wants.
- **`revision`** is an opaque hash of the descriptor (description, schemas, annotations) carried by each snapshot entry.
  - **Snapshot-bound calls** (`tool.call()` on an entry) pass their revision. If the current descriptor differs, the result is `stale` and **nothing is executed**.
  - **`catalog.call(id, input)` without a revision** means, explicitly, "whatever is currently registered under this id". That matches native name-based semantics.
  - **Safe by default where it matters:** a handle taken from a list given to an LLM never silently hits a changed contract.
- **What remains impossible to guarantee:**
  - An identical descriptor re-registered is indistinguishable from the original.
  - A same-origin navigation to a page exposing an identical tool is indistinguishable.
  - Check-then-`executeTool` is not atomic (issue #92). The browser's origin and exposure checks still apply.
- **Scope of stability:** the catalog's lifetime (one page session). Ids are **not** stable across reloads (keys follow discovery order), so never persist them.
- **Provider name limits** (e.g. `^[a-zA-Z0-9_-]{1,64}$`): ids can exceed 64 characters and may contain `.`, so ids stay SDK identity. The SDK ships a small deterministic mapper, `toProviderName(id, { maxLength, pattern })`. It sanitizes, truncates, and appends a short hash whenever it altered the id, which keeps distinct ids distinct.
- **Memory:** sources live in a `WeakMap`. Snapshot entries hold the latest `RegisteredTool` objects only, replaced on each refresh. `dispose()` removes the `toolchange` listener.

**Discovery API (decided: minimal, close to native):**

```ts nocheck
const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"] }); // passed through to native getTools
const tools = await catalog.getTools();     // fresh native query, normalized entries
// entry: { id, name, title, description, inputSchema, outputSchema, annotations, origin, source: { key, isSelf }, revision, call(input, { signal }) }
const off = catalog.subscribe((tools) => agent.setTools(tools)); // re-queries on `toolchange` (coalesced); React-store contract
catalog.getSnapshot();                      // last result, sync (for useSyncExternalStore)
await catalog.call(id, input, { signal, revision }); // revision optional (see above)
catalog.dispose();
```

- **Removed from pass 1:** `refresh()` (`getTools()` is the refresh), `snapshot.get(uniqueName)` (use `find`), `formatName` (replaced by the fixed id plus `toProviderName`), and the fingerprint-in-id `ToolId`.
- **Permissions:** the SDK passes `fromOrigins` through unchanged, and `call` hands the stored native `RegisteredTool` to `executeTool`. Exposure (`exposedTo`), origin checks and the permissions policy stay entirely native.
- **Typed known tools:** see the revision below (`find(contract)`).

### Revision 2026-11-10 (user input; consumer still in discussion)

**Stay isomorphic with WebMCP where it is already simple:**

| native WebMCP | SDK | difference |
| ------------- | --- | ---------- |
| `registerTool(tool, { signal, exposedTo })` | `registerTools(impls, { signal, exposedTo })` + `update()` | same option names; adds validation, the list and reconcile (D12) |
| `getTools({ fromOrigins })` | `catalog.getTools()` with `fromOrigins` passed through (catalog option) | same filter; adds normalized entries + `id` + `revision` |
| `executeTool(registeredTool, input, { signal })` | `catalog.call(id, input, { signal })` | **main gain: a stable string id instead of a native object reference** |
| `toolchange` event | `catalog.subscribe(listener)` | re-queries and hands over the new list |

**The id is a plain `string`** (not a branded type). An agent framework maps tool names back from LLM output as strings. An unknown id returns a `stale` result (nothing executed), never a throw.

**Typed calls come from a known contract, never from discovery.** Discovery happens at runtime, so on its own it can only give `unknown`. A contract you import (shared with the publisher) gives types, and the SDK checks that claim at runtime:

```ts nocheck
// dynamic: what an LLM agent uses; types are unknown, the provider validates
for (const t of await catalog.getTools()) {
  t.call(argsFromLLM);                    // input: unknown → ToolCallResult<unknown>
}

// known contract: typed and validated on both sides
import { searchProducts } from "@shop/contracts";            // the same defineTool() the page implements
const [search] = await catalog.find(searchProducts);          // entries whose name === contract.name, typed
const r = await search.call({ q: "red shoes" });              // input typed from the contract and validated locally before sending
if (r.ok) r.value.hits;                                       // output validated with the contract's output schema → typed
```

- **`find(contract)` replaces pass-1 `bindContract`.** It returns **id- and revision-bound** typed entries (several when several sources expose that name; the caller chooses), instead of a name-at-call-time binding. That is consistent with the id model: a typed handle never silently retargets.
- **What validation buys:** input errors are caught before any `executeTool`, as a local `input_invalid` with `handlerCalled: false` (nothing sent). Output that does not match the contract becomes `output_invalid` rather than a lie in the types. The provider may still reject input with its own envelope if its schema differs from yours.
- **What is not promised:** the SDK does not compare the advertised JSON Schema with the contract (JSON Schema equivalence is not decidable in general). Agreement is checked by validating real values.

Not adopted: no consumer-side delay or "grace period" rule. Earlier React discussions created no consumer requirement.

## Consumer lifecycle and React (D15)

**Desired experience (user):**

- **Core:** stays close to the WebMCP API, is type-safe when a contract is known, and makes calls simpler with stable ids.
- **React:** a hook (illustrative `useTools(origins)`) handles initial discovery, the `toolchange` subscription and dynamic updates, and exposes the list with the core's stable ids. React users never handle listeners.
- **Split:** the core keeps the catalog and identity logic. React must not redo it.

**Change subscription: `subscribe(listener)` rather than mirroring `addEventListener("toolchange")`.** The native event has no payload, so a faithful mirror would make every caller re-run `getTools()` by hand and handle the races. `subscribe` hands over the new typed list, follows the React external-store contract (no immediate emit) and returns an unsubscribe function. That is real ergonomic and typing value, so this adaptation is justified. `getTools()` and `call()` stay native-shaped (D13 table).

**Core catalog:**

```ts nocheck
const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"] });
catalog.getSnapshot();     // { status: "idle" | "loading" | "ready" | "unsupported" | "error", tools, error?, version }
catalog.subscribe(fn);     // first subscriber starts discovery + the toolchange listener; the last one leaving stops them
await catalog.getTools();  // explicit query (also updates the snapshot if it is the latest)
catalog.update({ fromOrigins: [...] }); // compared by value (sorted set), not array identity; re-queries if changed
catalog.call(id, input, { signal, revision? });
await catalog.find(contract);           // typed entries (D13 revision)
catalog.dispose();         // stops everything; in-flight results ignored; later calls → stale
```

- **Lazy:** creating a catalog has no side effects. Discovery runs only while someone subscribes or calls `getTools()`, as in TanStack observers. That makes creation safe during a React render.
- **Page-wide identity table.** The `WeakMap<WindowProxy, sourceKey>` and the monotonic counter live at module level (one per SDK instance in the page), not per catalog. Every catalog in the page therefore shows **the same ids for the same tools**, and recreating a catalog (remount, StrictMode, origin change) never renumbers anything. Two copies of the SDK bundled in one page would have separate tables (documented).
- **Races, handled in the core:**
  - Every query carries a sequence number, and only the **latest completed** query updates the snapshot. A listener never sees an older list after a newer one.
  - A burst of `toolchange` events coalesces into at most one query in flight plus one pending.
  - `version` increases with each applied snapshot.
- **Origin changes:**
  - Tools from origins no longer requested drop out of the snapshot, and calls to their ids return `stale`.
  - Re-adding an origin brings back the **same ids**, as long as the source (WindowProxy + origin) is the same.
- **Status:**
  - `unsupported` when the consumer API is missing (progressive enhancement, D1): empty list, no throw.
  - `error` when the native `getTools` rejects (e.g. `SecurityError` for an invalid origin), with `error` set and an empty list. This is a developer mistake and is surfaced as such.
- **Not promised:**
  - `fromOrigins` is a **request filter**. Owner-side `exposedTo` and the permissions policy still decide, and adding an origin never grants access.
  - Discovered tools stay `unknown` unless matched through `find(contract)`.

**React:**

```tsx nocheck
function AssistantPanel() {
  const { status, tools, call } = useTools({ fromOrigins: ["https://widgets.example"] });
  useEffect(() => {
    agent.setTools(tools.map((t) => ({ name: toProviderName(t.id), description: t.description, parameters: t.inputSchema })));
  }, [tools]);                                   // a new array only when the snapshot changes
  if (status === "unsupported") return null;
  return <ToolList tools={tools} />;
}
```

- **Internals (no logic duplicated):**
  - `useState(() => createToolCatalog(options))` creates the catalog, which is lazy and therefore safe during render.
  - `useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)` reads it. Subscribing starts discovery, and unsubscribing on unmount stops it.
  - An effect calls `catalog.update({ fromOrigins })` when the origins change **by value**. Inline array literals are therefore fine.
  - `dispose` runs on unmount.
- **StrictMode:** the double mount unsubscribes and then subscribes again. Ids are unaffected because of the page-wide table.
- **Returned values:** `{ status, tools, error, call, find }`. `tools` keeps its identity while `version` is unchanged, which makes it safe as an effect dependency.
- **Typed known tools in React:** `find(contract)` is async. A convenience such as `useTool(contract)` returning typed entries from the current snapshot is feasible on top of the same snapshot. It is not added until a need shows up.

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

### Output validation (D9)

**Platform facts, re-checked 2026-11-10:**

- **Draft:** the WebMCP draft (Draft CG Report, **9 November 2026**, latest commit `f2f2ae2`) still has `outputSchema` in `ModelContextTool`. Its wording: "Tool output is expected to conform to the provided schema, and agents may reject outputs that do not validate."
- **Browsers do not validate output.** The only output failure the draft defines is an unserializable result (JSON serialization), which reaches the caller as an opaque `OperationError`.
- **Polyfill:** the official `@w3c/webmcp-polyfill` (0.1.0, `main` at `042327b`, 2026-11-09) never references `outputSchema` in its source or tests. Native exposure of an output schema therefore cannot be assumed everywhere.

**Decision:**

1. **`output` is optional.** Declaring it means "check this", so the SDK validates every result (awaiting async validators). There is no `validateOutput: false`. Reasons:
   - The schema is a promise advertised to the agent. A mode where the advertised schema may be violated undermines that promise.
   - Transforms (e.g. `Date → string`) **require** running the validator to produce the wire value, so "skip validation" is not even well defined.
   - The cost is negligible for tool-sized results.
   - Not wanting a check means not declaring the schema.
2. **Internal validation is independent of native exposure.** The SDK validates whenever `output` is declared, whether or not the platform or polyfill shows `outputSchema` to agents. *Whether* and *how* the descriptor carries `outputSchema` (and the failure-envelope `anyOf`) is decided at the envelope step, which has not been discussed yet.
3. **Value of a browser-side check:** it guards the page-to-agent contract against drift between app types and the advertised shape, unchecked casts of API JSON, and plain bugs. It **complements, and does not replace,** server-side validation and authorization. The server protects its data, while the page check protects what the agent is told.
4. **Without an output schema:**
   - **Types:** the handler returns `JsonValue | void` (compile-time guard only; a cast can bypass it), and consumers see `unknown`.
   - **Runtime:** no validation. `void`/`undefined` is sent as `null`. The SDK serializes the result to JSON itself, so a failure (cycles, `bigint`) becomes a clear `output_invalid` instead of the browser's opaque `OperationError`.
   - **Known gap:** `JSON.stringify` is lossy without failing (it drops `undefined` and functions in objects, and turns `Date` into a string via `toJSON`). Declare a schema when the shape matters.
5. **What `output_invalid` tells the agent:**
   - **Framing:** "The tool ran, but its result did not match its declared output and was withheld. The action may have been performed. Check the current state before retrying. Retrying the same call may repeat the action and is unlikely to fix this."
   - **Facts:** `handlerCalled: true`. It is not "execution failed", and the agent is not invited to fix a page bug by retrying.
   - **Issues** stay out of the agent response (the agent cannot fix them, and messages may echo internal values). They go to the developer hook.

### Handler errors (D10)

**Principle (user):** an unexpected exception (a defect) tells the agent something went wrong, with no internal details. Only errors that are useful to the agent are exposed, and only explicitly.

**Mechanisms compared:**

| mechanism | verdict |
| --------- | ------- |
| **Result return** (`return fail(...)` / `{ ok: false }`) | ❌ The handler's return type becomes `Output \| Failure`, which pollutes output-schema typing. The SDK must tell a failure from a legitimate output (it needs a brand anyway). Failures from nested services must be threaded back up by hand. Expected business outcomes already go in the output (D7). |
| **Throw a dedicated class** `ToolError` | ✅ Idiomatic JS. Works from any depth (a service layer can throw it). Leaves the return type untouched. |
| **Subclasses of `ToolError`** | ✅ The extension point for custom errors, reusable across tools, with no extra API. |
| a factory `toolError(...)` | redundant with the class: one way only |

**Shape:**

```ts nocheck
new ToolError(message: string, options?: { code?: string; data?: JsonValue; cause?: unknown })
```

- **`message`** is **required** and must be non-empty. It is the only text that tells the agent what happened and what to do next. Making it required is what "the signature guides the author" means here.
- **`code`** is optional. It is a stable identifier for programmatic consumers (`bindContract`, logs). Agents read the message, so forcing a code would be ceremony. When absent, it is omitted from the response (no default value).
- **`data`** is optional, typed `JsonValue`, for structured facts (e.g. `{ left: 2 }`). If it fails to serialize at runtime, it is dropped, the message and code are still sent, and the problem is reported to the developer hook. A business error never degrades into `internal`.
- **`cause`** is local only, passed to the developer hook and never sent.
- **No `retryable`.** That question belongs to the next step (`handlerCalled`/retry guarantees).

**Whitelist, not spread.** The agent response is built only from `message`, `code` and `data`. It never includes `name`, `stack`, `cause`, other own or inherited properties, subclass fields, or `toString()`. A subclass that wants something sent must put it in `data`.

**Identification:** a brand rather than bare `instanceof`. `ToolError.prototype[Symbol.for("webmcp-sdk.tool-error")] = true`, checked by an exported `isToolError(e)`. It survives duplicated package copies (two SDK versions in one bundle), where `instanceof` fails. Realms are a lesser concern, because handler and SDK run in the same page realm, but the brand covers them too. The cost is one symbol and one function.

**Scope:** `ToolError` is honoured when thrown from the handler, including code it calls. A throw from a schema validator stays `internal` with `handlerCalled: false` (the errors proposal). Non-`Error` throws (strings, objects) are defects. Throws caused by abort or interruption are handled in a later step.

**Anti-leak guarantee:**

- **What is guaranteed:** nothing reaches the agent *implicitly*. That covers defect messages, stacks, causes and extra fields.
- **What is not guaranteed:** what the author writes *explicitly* into `message` or `data` is sent as-is, and the SDK does not scan for secrets.
- **Documented pitfall:** `throw new ToolError(apiError.message)` forwards a third-party message verbatim.

**Examples:**

```ts nocheck
// minimal
if (!user.canExport) throw new ToolError("Exporting requires an admin. Ask the user to sign in as an admin.");
// agent: { kind: "tool_error", handlerCalled: true, message: "Exporting requires an admin. …" }

// with code + data
throw new ToolError(`Only ${left} left. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { left } });

// custom, reusable subclass: extra fields are local unless put in data
class OutOfStockError extends ToolError {
  constructor(readonly sku: string, left: number) {
    super(`Only ${left} left for ${sku}. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { sku, left } });
  }
}

// defect: anything else
throw new Error("db connection reset");
// agent: { kind: "internal", handlerCalled: true, message: "The tool failed unexpectedly. It may have partially run; check the current state before retrying." }
// developer hook: the original Error, with stack and cause
```

### Proposed taxonomy: five kinds, each mapped to an agent action

| kind | `handlerCalled` | what the agent is told |
| ---- | --------------- | ---------------------- |
| `input_invalid` | `false` | did not run; fix these fields (issues) and call again |
| `tool_error` | `true` | the author's `ToolError` message, `code`, `data` |
| `internal` | `true` or `false` | failed unexpectedly; if called: may have partially run, check state before retrying |
| `output_invalid` | `true` | ran, but its result failed validation; the action may have been performed; check state |
| ~~`interrupted`~~ | — | removed by D16: removal never cancels a running call |

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

```ts nocheck
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
