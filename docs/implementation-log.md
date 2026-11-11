# Core runtime implementation log

Implemented on 2026-11-11, starting from `7a39a92` on `main`. The approved README, public TypeScript signatures, D20 surface and research addenda govern this implementation. React remains unchanged and unimplemented. No publishing, pushing, monorepo changes or CI changes.

## Implementation

1. Definitions perform runtime name/description checks and are shallow-frozen. Implementations are shallow-frozen, with handlers stored privately in a WeakMap.
2. JSON Schema conversion requests draft-2020-12 on the input/output side as appropriate, caches both success and failure per definition, and rejects a non-object input root. `withJsonSchema` preserves the validator rather than compiling JSON Schema into one.
3. Registration and `runTool` share one executor. It awaits validators, applies transforms, caps input issues at 20, whitelists branded ToolError fields, withholds invalid output, and reports unexpected failures only to the developer hook. JSON serialization checks follow JSON.stringify semantics, including its documented lossy conversions.
4. Registration resolves the context when called, passes native lifetime/exposure options through, advertises output/envelope anyOf, maps registration errors, and supports partial batch failure. Pending registration state is per context/name; an aborted pending registration must settle natively before its replacement enters the native registry. A failed concurrent duplicate does not hide the older pending registration. This coordination does not cancel executions or claim externally owned names.
5. Catalog state is entirely instance-owned. Source identity uses a WeakMap by window, then origin; issued names remain recognized for the lifetime of the instance, including after disposal. Native descriptors are refreshed on discovery; calls use the current descriptor. Events coalesce while a query is running, sequence numbers prevent stale queries from publishing, and subscriber exceptions are logged without corrupting discovery.

## Internal adjustments and documentation

No exported package signatures were changed. `src/runtime.ts` holds shared lazy context lookup and abort-aware waiting. Internal module exports share the executor and schema cache; these are not added to the package entry point. Native settlement is observed even after SDK abort rejection so replacement coordination remains correct.

The README now accurately distinguishes the implemented core from deferred React, documents internal pending-registration coordination, lists the fixed generic failure messages explicitly, adds test commands, and links this log. The package description and NotImplementedError comment were corrected to the same status. Definitions and implementations are shallow-frozen: supplied schemas and metadata are not recursively frozen.

No blocking API contract issue was encountered. The task references a D16 audit table in `docs/design.md`; the starting revision contains D16's decision row but no corresponding audit section/table. Its explicit decision and the 2026-11-11 research addendum supply the unregister behavior implemented and tested here. The missing table was not reconstructed or treated as evidence.

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

Cross-origin frames, permissions-policy/exposedTo enforcement, actual frame navigation/WindowProxy retention, owner/caller unload behavior, toolcancel events, other browser engines, real agents and provider schema enforcement are not verified. Origin-change naming is simulated in the FAKE suite. React lifecycle/StrictMode behavior is intentionally deferred. Output schemas do not reach polyfill consumers, and in-band envelopes remain ambiguous with identically shaped successful values as documented in the README.
