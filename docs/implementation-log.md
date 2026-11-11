# Core runtime implementation log

Implemented on 2026-11-11, starting from `7a39a92` on `main`. The approved README, public TypeScript signatures, D20 surface and research addenda govern this implementation. Core and React are implemented; the review fixes below describe the current runtime. No publishing, pushing, monorepo changes or CI changes.

## Implementation

1. Definitions perform runtime name/description checks and are shallow-frozen. Implementations are shallow-frozen, with handlers stored privately in a WeakMap.
2. JSON Schema conversion requests draft-2020-12 on the input/output side as appropriate, caches both success and failure per definition, and rejects a non-object input root. `withJsonSchema` preserves the validator rather than compiling JSON Schema into one.
3. Registration and `runTool` share one executor. It awaits validators, applies transforms, caps input issues at 20, whitelists branded ToolError fields, withholds invalid output, and reports unexpected failures only to the developer hook. JSON serialization checks follow JSON.stringify semantics, including its documented lossy conversions.
4. Registration resolves the context when called, passes native lifetime/exposure options through, advertises output/envelope anyOf, maps registration errors, and supports partial batch failure. Pending registration state is per context/name; an aborted pending registration must settle natively before its replacement enters the native registry. A failed concurrent duplicate does not hide the older pending registration. This coordination does not cancel executions or claim externally owned names.
5. Catalog state is entirely instance-owned. Source identity uses a WeakMap by window, then origin; issued names remain recognized for the lifetime of the instance, including after disposal. Native descriptors are refreshed on discovery; calls use the current descriptor. Events coalesce while a query is running, sequence numbers prevent stale queries from publishing, and subscriber exceptions are logged without corrupting discovery.

## Internal adjustments and documentation

No exported package signatures were changed. `src/runtime.ts` holds shared lazy context lookup and abort-aware waiting. Internal module exports share the executor and schema cache; these are not added to the package entry point. Native settlement is observed even after SDK abort rejection so replacement coordination remains correct.

The README now accurately describes the implemented core and React bindings, documents internal pending-registration coordination, lists the fixed generic failure messages explicitly, adds test commands, and links this log. The package description and NotImplementedError comment were corrected to the same status. Definitions and implementations are shallow-frozen: supplied schemas and metadata are not recursively frozen.

No blocking API contract issue was encountered. D16 governs unregister behavior. The audit reference supplied for this work is `docs/design.md`, “Spec audit, 2026-11-11 (subagent, verified by Opus)”; the earlier log assertion that the audit table was absent is withdrawn. The decision itself and the 2026-11-11 research addendum also supply the unregister behavior implemented and tested here.

For a maxNameLength too small to contain the prefix, source tag, collision suffix and at least one tool-name character, discovery records an error and resolves an empty list rather than issuing an overlong/colliding name. No new public option or naming format was introduced.

## Test environment and commands

Dependencies were installed using pnpm 10.33.3 without bypassing the configured `minimumReleaseAge` of 4320 minutes. Versions: Vitest and @vitest/browser-playwright 5.1.0; Playwright 1.59.1; official @w3c/webmcp-polyfill 0.1.0. Playwright 1.65.0 was initially examined but needs uncached revision 1254. Version 1.59.1 matches cached Chromium/headless-shell revision 1217 (Chrome for Testing 147.0.7727.15) and FFmpeg 1011 exactly, so no browser download was needed.

- `pnpm test`: 35 unit tests, two files. `tests/FAKE-model-context.ts` is explicitly a FAKE of selected draft algorithms, not a browser implementation or conformance oracle. `tests/core.FAKE.test.ts` covers definitions, conversion failures (including Zod date input), caching, wrappers, async refinements, input/output transforms, issue paths/root/cap, field whitelisting, defects, throwing validators/hooks, unserializable output/data, envelope guards, anyOf advertisement, unsupported environments, native error mapping, partial failure, abort timing, pending-registration ordering, caller cancellation, and D16 late delivery. `tests/catalog.FAKE.test.ts` covers naming, source/origin changes, collisions, truncation, prefixes, instance independence, sticky names, snapshot array identity, stale query exclusion, event coalescing/unsubscribe, origin-set comparisons, late context installation, discovery errors, all call-result kinds, malformed JSON and disposal during discovery.
- `pnpm test:browser`: 4 integration tests in real headless Chromium, **testing the official POLYFILL, not native WebMCP**. Covers registration/discovery/call with validation, caller abort, unregister during execution, and a same-origin iframe with its own polyfill installation and an `f1` source. The suite asserts absence of native modelContext before installing, so it cannot silently report native behavior as polyfill behavior. The iframe installs the package's browser bundle; SDK production code never imports a polyfill.
- `pnpm check`: source/example/type-test typecheck and typechecking all 23 README/docs code blocks. Test/config files are run by Vitest; they are not part of the existing production TypeScript check.

Both Vitest commands run once and exit; no watch mode or manually started server is used.

## Observed polyfill behavior versus the draft

| Behavior | Draft / D16 expectation | Observed official polyfill 0.1.0 in Chromium |
| --- | --- | --- |
| Unregister an already-running call | Remove future availability; leave execution signal live; deliver late result | Matches: absent from next discovery, signal not aborted, result 17 delivered |
| Caller abort | Reject caller, abort callback signal, ignore late result | Caller rejected as AbortError; callback signal then aborted; callback was allowed to settle afterward |
| Advertised outputSchema | Current draft carries outputSchema | Polyfill drops it from discovery, despite SDK sending it (asserted in browser suite); SDK advertisement is independently checked in unit tests |
| Same-origin iframe discovery/call | Distinct window source | Discovered as f1__frame_tool; invocation returned frame result |

The caller-abort browser test verifies rejection and signal delivery; it does not instrument the polyfill's internal execution maps or prove all late-result cleanup behavior. The research addendum's observation that this polyfill omits toolcancel events is static research, not a new assertion made by this suite.

## Known gaps

**Native WebMCP not tested.** No Chrome flags or origin trials were enabled. The fake tests are algorithm models, not evidence of native platform conformance. Browser integration covers only the installed polyfill and cached Chromium version.

Cross-origin frames, permissions-policy/exposedTo enforcement, actual frame navigation/WindowProxy retention, owner/caller unload behavior, toolcancel events, other browser engines, real agents and provider schema enforcement are not verified. Origin-change naming is simulated in the FAKE suite. React lifecycle and StrictMode are covered by the unit and polyfill suites described below. Output schemas do not reach polyfill consumers, and in-band envelopes remain ambiguous with identically shaped successful values as documented in the README.


## React bindings implementation (2026-11-11)

Implemented on main from `8ebceae`, preserving every public signature and the approved React lifecycle contract. The core implementation sections above describe the earlier checkpoint; their original React-deferred status has been corrected above.

1. `useRegisterTools` reconciles after every commit, keyed by definition identity. Removed registrations abort before additions start, with one controller per definition. Committed implementations and diagnostic callbacks refresh without re-registering. Origin exposure sets compare by value; context changes and disabling remove the previous lifetimes. Unmount aborts registrations only, never running execution signals. Errors and unsupported environments become hook state.
2. Internal implementation accessors build forwarding wrappers without adding package exports. The shared executor captures the actual committed handler at call start, before asynchronous validation, preserving that handler through a later render or unmount.
3. Internal core coordination now retains pending and active SDK ownership per context/name. Duplicate errors carry an internal reference to the conflicting owner's lifetime; the React binding retries after it ends. Native registration settlement still gates replacement ordering. Foreign conflicts are not retried. StrictMode cleanup/replay uses that same ordering.
4. `RegisterTools` delegates to the hook and renders children as-is. Development commits detect repeated definition identity churn; production suppresses the warning.
5. `useToolCatalog` lazily owns one catalog, reads it with `useSyncExternalStore`, and updates origin sets by value. It never disposes. First-subscribe discovery already existed and needed no new hook. Catalog construction did read `document.defaultView`; this lookup now happens at discovery, so lazy state creation and SSR do not touch document.

### Validation and documentation

Added only development dependencies: React DOM 19.3.1, its types 19.3.0, and happy-dom 21.0.4. Registry versions were checked before installation; pnpm 10.33.3 retained the configured `minimumReleaseAge` of 4320 minutes. No runtime dependencies, monorepo configuration, or CI changes were made.

- `pnpm check`: source/examples/public type tests and all 23 README/docs code blocks pass.
- `pnpm test`: 52 tests in four files: core FAKE 26, catalog FAKE 9, React FAKE 16, React SSR 1. React tests cover mount/unmount, factory refresh after commit, capture before async validation, list changes, ordered same-name replacement, disabling, context/exposure changes, pending settlement, StrictMode, component/core duplicate ownership and retry, foreign conflicts, unsupported/late installation, running calls, latest diagnostics, development/production warnings, children, catalog events/origin equality/idle cleanup/no disposal, and server rendering with a throwing document getter.
- `pnpm test:browser`: 5 tests in two files. The new React app mounts publisher and consumer components in StrictMode, discovers, calls, removes the publisher, and checks disappearance and unavailability using the same catalog. This tests real Chromium with the official **POLYFILL**, not native WebMCP. Four existing core browser cases also pass.

README changes are limited to two status statements: the prototype banner now says core and React are implemented/tested, and the runtime status row reports both implementations and their unit/polyfill coverage. The package description and retained NotImplementedError comment were updated to match. The prior D16 audit-absence claim was removed as requested.

No blocking API contract issues. Not verified: native WebMCP, React 18 in a separately installed test matrix (tests run React 19.3.1), production bundler output, concurrent abandoned-render scheduling beyond direct render-before-commit checks, cross-origin enforcement or frame unload behavior. Existing core browser limitations above still apply. All runners exit; no manual server or background process is left running. No push or publish.


## Review fixes (2026-11-11)

Applied against `9e4a65e` on main, preserving public function signatures and adding no public options.

| Item | Status and evidence |
| --- | --- |
| 1 | Done: value-based React publication and a per-name consecutive-commit churn guard; inline definitions settle into a stable module-scope error. |
| 2 | Done: separate pending attempts and live owners; successful ownership promotion, failed-conversion race and React retry tests. |
| 3 | Done: guarded JSON snapshots; business error data serialized under `error.data`; key-sensitive and second-call serialization tests. |
| 4 | Done: first same-name occurrence wins, with a duplicate error for every later occurrence, including repeated definition identity. |
| 5 | Done: abortable lifetime subscriptions remove waiting continuations; direct coordination and unmounted React waiter tests. |
| 6 | Done: returned hook promises/thenables are observed and rejection is logged; synchronous exceptions remain contained. |
| 7 | Done: active update retries a missing context even with unchanged origins. |
| 8 | Done: independent default publisher/consumer detection; explicit contexts bypass feature filtering. |
| 9 | Done: finite positive integer name-budget validation; insufficient positive budgets remain discovery errors. |
| 10 | Done: FAKE catches serialization failure, ignores cancelled late results, clones input, and checks descriptor origin. This is not conformance evidence. |
| 11 | Done: idle update only stores origins; dead call-time discovery removed; replacement handler invoked without rediscovery. |
| 12 | Done: separate malformed-JSON mapping with exact message; plain-object argument and rejected-result docs corrected. |
| 13 | Done: normalization, truncation and collision suffixes documented in README and CatalogTool JSDoc. |
| 14 | Done: output validation reports Error with issues as cause; runTool documents that it invokes no hook. |
| 15 | Done: centralized agent messages, exact wording tests for all failure kinds and both internal execution stages. |
| 16 | Done: registration coordination, native construction/error mapping, name issuing, React registration/warning helpers, shared utilities and context/abort modules extracted. Internal exports tagged; module WeakMaps listed; brand is a class member; unused helper removed. |
| 17 | Done: focused test cases, shared deferred helper, explicit gates instead of microtask-count waits, direct name-issuer tests, StrictMode intermediate-state assertion, contained subscribers, conversion-failure cache, successful-output diagnostic silence, and SSR assertions outside render. |

Verification: `pnpm check` passes TypeScript and all 23 README/docs code blocks. `pnpm test` passes 128 tests in seven files; `pnpm test:browser` passes five tests in two files. Unit suites use a FAKE (including React in happy-dom); browser suites use Chromium and the official polyfill. Native WebMCP, other browser engines, cross-origin enforcement, frame unload and a separate React 18 matrix remain unverified.

A temporary archive of the original HEAD with selected new regression tests produced 20 failures, including the original maximum-update-depth failure, serialization failures, missing-context update, feature detection, invalid budgets and all four FAKE transport regressions. The temporary archive was removed. Supporting tests that assert already-correct behavior can pass on the old runtime; no native-conformance claim follows from either run. All runners exit, with no manual background server. No push, publish, CI or monorepo changes.
