> Quoted excerpts (WebMCP IDL and spec text, library documentation) remain the work of their respective authors under their own licenses. They are reproduced briefly, with links, for reference. They are not covered by this repository's MIT license.

# TL;DR for API designer

- **EXPERIMENTAL:** Target `document.modelContext`, not `navigator.modelContext` or `window.agent`; WebMCP remains a CG draft, not a W3C Standard. [Draft, 2026-11-02](https://webmachinelearning.github.io/webmcp/).
- **EXPERIMENTAL:** Registration is `Promise<undefined>`; cleanup uses the registration options’ `AbortSignal`. No current `unregisterTool`, `provideContext`, `clearContext`, or returned registration handle. [Spec source, commit 6cd745a, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).
- **EXPERIMENTAL:** Consumer APIs **do exist in the draft**: `getTools()`, `executeTool(RegisteredTool, object?, options?)`, and `toolchange`/`ontoolchange`; preserve frame identity, not just tool names. [Draft §4, 2026-11-02](https://webmachinelearning.github.io/webmcp/#api).
- **EXPERIMENTAL:** Tools have optional `title`, `inputSchema`, **`outputSchema`**, and four WebMCP annotations; `execute(input, { signal })` returns JSON-serializable data, not a required MCP content envelope. [Spec source, 6cd745a, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).
- **EXPERIMENTAL:** Names are document-local, 1–128 ASCII letters/digits/`_-.`; duplicates reject with `InvalidStateError`. Registration cancellation does not cancel an already-running callback. [Spec source, 6cd745a, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).
- **EXPERIMENTAL:** Secure contexts and the `tools` permissions policy apply; cross-origin discovery uses two-sided `exposedTo`/`fromOrigins` opt-in. Chrome has an experimental rollout, with conflicting summary metadata; do not promise universal availability. [Draft, 2026-11-02](https://webmachinelearning.github.io/webmcp/), [Chrome Status, updated 2026-11-02](https://chromestatus.com/feature/5117755740913664).
- **EXPERIMENTAL:** The official package is now `@w3c/webmcp-polyfill@0.1.0`; MCP-B’s `@mcp-b/webmcp-polyfill` and `@mcp-b/global` are separate community packages, currently 6.0.3. The unscoped npm name is unrelated. [Official package](https://registry.npmjs.org/@w3c/webmcp-polyfill/0.1.0), [MCP-B](https://github.com/WebMCP-org/npm-packages), accessed 2026-11-06.
- **PUBLIC API:** Accept Standard Schema validation and Standard JSON Schema conversion as separate capabilities. Both interfaces are published in `@standard-schema/spec@1.1.0`; validation alone cannot generate JSON Schema. [Interfaces](https://unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts), accessed 2026-11-06.
- **PUBLIC API:** JSON Schema conversion must select input versus output explicitly and retain runtime validation; transforms, refinements, Date, bigint, and custom values are not universally representable. [Zod 4.6.7 docs](https://zod.dev/json-schema), [Valibot converter 1.8.0](https://unpkg.com/@valibot/to-json-schema@1.8.0/README.md), accessed 2026-11-06.
- **PUBLIC API:** Effect is now 4.1.2; its canonical JSON codec conversion differs from old `JSONSchema.make` examples. ArkType 2.2.9 exposes separate Standard JSON Schema input/output converters. [Effect package](https://unpkg.com/effect@4.1.2/dist/Schema.d.ts), [ArkType implementation](https://unpkg.com/@ark/schema@0.56.8/out/roots/root.js), accessed 2026-11-06.
- **PUBLIC API:** oRPC’s stable npm major is **1** (1.16.1); the current website also documents **2.0 beta**. Borrow contracts → implementer → handler/router, explicit context, middleware, and declared error maps, but pin the reference version. [npm tags](https://registry.npmjs.org/@orpc/server), [v1 contracts](https://v1.orpc.dev/docs/contract-first/implement-contract), accessed 2026-11-06.
- **PUBLIC API:** TanStack’s useful patterns are typed options factories, framework-independent core, thin framework adapters, and opt-in `Register` augmentation. Standard Schema support often removes adapters; Form deliberately retains input values. [Query options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options), [Form](https://tanstack.com/form/latest/docs/framework/react/guides/submission-handling), accessed 2026-11-06.
- **PUBLIC API:** Latest MCP is **2026-07-28**: distinguish its `CallToolResult` envelope and annotations from WebMCP’s plain JSON result and different annotations. MCP naming rules are SHOULDs; WebMCP registration enforces them. [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), accessed 2026-11-06.

## Scope, evidence, and labels

Research/access date for **every source and observation below: 2026-11-06**. Package versions and draft/commit dates are recorded separately; access date is not a claim about release date. Only this document was created; no library implementation or commits.

- **STANDARD:** W3C/WHATWG standard text. WebMCP is explicitly not one yet, so its draft statements below are labeled EXPERIMENTAL even where the draft uses normative algorithms.
- **PUBLIC API:** Published/documented library interfaces or the published MCP protocol specification; Standard Schema is an ecosystem specification, not a W3C standard.
- **EXPERIMENTAL:** CG draft, flagged/origin-trial browser surface, or polyfill implementation of that surface. Publication on npm does not make the underlying browser API stable.
- **UNVERIFIED:** Not confirmed, contradictory, or outside the evidence fetched. Design implications are identified as recommendations/inferences, not existing APIs.

## 1. WebMCP — highest priority

### 1.1 Authority and exact IDL

**EXPERIMENTAL — primary baseline:** [WebMCP draft](https://webmachinelearning.github.io/webmcp/) says Draft Community Group Report, **2 November 2026**, and explicitly disclaims W3C Standard/Standards Track status. Its [source at commit `6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2`](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs), committed **2026-11-02T13:10:19Z**, is the exact baseline for the excerpts below. Search-index excerpts initially omitted `outputSchema` and used `any` for the execution input; directly fetched source has `outputSchema` and `object`. Prefer the pinned source over snippets or stale caches.

**EXPERIMENTAL — verbatim IDL excerpts from that source** (comments omitted, declarations unchanged):

```webidl
partial interface Document {
  [SecureContext, SameObject] readonly attribute ModelContext modelContext;
};

[Exposed=Window, SecureContext]
interface ModelContext : EventTarget {
  Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
  Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
  Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options = {});

  attribute EventHandler ontoolchange;
  attribute EventHandler ontoolactivated;
  attribute EventHandler ontoolcancel;
};

dictionary ModelContextTool {
  required DOMString name;
  USVString title;
  required DOMString description;
  object inputSchema;
  object outputSchema;
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;
};

dictionary ToolAnnotations {
  boolean readOnlyHint = false;
  boolean untrustedContentHint = false;
  boolean consequentialHint = false;
  boolean debugging = false;
};

dictionary ToolExecuteCallbackOptions {
  required AbortSignal signal;
};

callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);

dictionary ModelContextRegisterToolOptions {
  sequence<USVString> exposedTo;
  AbortSignal signal;
};

dictionary ModelContextGetToolOptions {
  sequence<USVString> fromOrigins;
};

dictionary ModelContextExecuteToolOptions {
  AbortSignal signal;
};

dictionary RegisteredTool {
  required DOMString name;
  DOMString title;
  required DOMString description;
  object inputSchema;
  object outputSchema;
  required Window window;
  required USVString origin;
  ToolAnnotations annotations;
};
```

**EXPERIMENTAL — entry point:** It is the document’s same-object `ModelContext`, exposed on Window realms in secure contexts. No `window.agent`, worker entry point, or `navigator.modelContext` declaration occurs in this IDL. [Draft §4.1–4.2, 2026-11-02](https://webmachinelearning.github.io/webmcp/#document-extension). Chrome’s [current imperative guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/agentic-javascript-tools), accessed 2026-11-06, calls the navigator entry point deprecated in Chromium 150 and lists `unregisterTool`, `provideContext`, and `clearContext` as removed.

### 1.2 Registration, removal, names, schemas

**EXPERIMENTAL — lifetime:** `registerTool` resolves to `undefined`, not a disposer. Pass `{ signal }` as the second argument and abort that registration controller to remove the tool; no public name-based unregistration method remains. An already-aborted registration signal rejects with its abort reason. The internal unregistration algorithm removes the name and schedules tool-change notifications. Its explicit note separates registration lifetime from invocation lifetime: removing a tool does not cancel a callback already invoked. [Pinned source, registerTool/unregister algorithms, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — rejection vs synchronous throw:** A duplicate in the same `ModelContext` rejects with `InvalidStateError` DOMException; invalid/empty name or empty description does likewise. The allowed name characters are ASCII alphanumerics, `_`, `-`, `.`; length 1–128. The name is the map key, so case is significant and another document can use the same name. Inactive documents reject `InvalidStateError`; denied `tools` policy rejects `NotAllowedError`. Web IDL conversion failures, such as missing required descriptor members or non-object schemas, can throw `TypeError` before the promise-returning algorithm. [Pinned source §3–4, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — shape/dialect:** `name`, `description`, and `execute` are required; `title`, `inputSchema`, `outputSchema`, and annotations are optional in IDL. Both schemas are JavaScript objects intended as JSON Schema; the normative JSON-SCHEMA reference resolves to **2020-12 core**. The actual serialization algorithm JSON-stringifies them; it does not perform a complete dialect-aware JSON Schema validity check or validate callback input/output. Omitted schemas are stored as an empty-string sentinel. Serialization failures reject with the serialization exception. Output is expected to match `outputSchema`, and agents may reject nonconforming output. Do not infer that the browser performs runtime validation merely from the schema description. [Draft dictionaries/reference list](https://webmachinelearning.github.io/webmcp/#model-context-tool), [serialization/execution algorithms in pinned source, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — annotations differ from MCP:** WebMCP has `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, and `debugging`, all default false; it does not declare MCP’s `destructiveHint`, `idempotentHint`, or `openWorldHint`. Chrome’s imperative docs, updated **2026-10-16**, specifically mark `debugging` as available from **Chrome 156**, illustrating why draft presence and browser support must be tracked separately. [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

### 1.3 Callback, result, cancellation, errors

**EXPERIMENTAL — callback:** The second argument is an execution options dictionary containing an `AbortSignal`; it is not a client/agent instance. No `requestUserInteraction()` member exists in the current callback IDL. The declared return is `Promise<any>`; the invocation algorithm serializes the fulfilled value to a JSON string. A plain object, array, primitive, or null that serializes successfully is a possible result; an MCP `{ content: [...] }` object is merely one possible payload, not a mandated envelope. `executeTool()` resolves to the serialized **string**, including JSON quoting for string results. [Pinned source callback/execution algorithms, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — execution cancellation:** `executeTool(tool, args, { signal })` rejects with the caller signal’s abort reason when aborted. The owner callback receives a separate controller’s signal; cancellation signals it without copying the caller’s custom reason and fires `toolcancel`. Cancellation is cooperative, not a rollback or forced JavaScript interruption; late completion is ignored. Document unload is also integrated into pending-execution cleanup. [Pinned source §3.1 and cancellation algorithms, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — failures:** Callback rejection (including an async callback throwing) and unserializable results map to `OperationError`; absent tools to `NotFoundError`; input that cannot parse to an object to `DataError`; target unload to `AbortError`. The callback’s rejection reason may be logged to the console but is not forwarded as the caller-visible exception payload. Author-defined actionable failures can instead be returned in JSON. WebMCP defines no special `isError` result semantics. [Pinned source tool-execution-error table](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs), [Chrome guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/agentic-javascript-tools), accessed 2026-11-06.

### 1.4 Consumer APIs, events, frames, origins

**EXPERIMENTAL — yes, consumer APIs are in the draft:** `getTools()` discovers descriptors, including owner `window` and `origin`; `executeTool()` takes that descriptor, not a bare name. Omitted input becomes a fresh empty object. Schemas returned by discovery are copies; `RegisteredTool` contains no callable `execute`. Discovery sorts names by code units. These are explicitly intended for in-page JavaScript agents; browser agents have separate internal observation machinery. [Pinned source §4.2 and §5, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — yes, `toolchange` exists:** `ModelContext` extends `EventTarget`, declares `ontoolchange`, and receives ordinary `toolchange` events after registration/removal and relevant document-tree changes. The notification algorithm filters by exposure and permissions. Do not assume synchronous delivery or an event payload listing added/removed tools; the draft fires a plain event. `toolactivated` and `toolcancel` are also specified; their `ToolActivatedEvent`/`ToolCancelEvent` subclasses expose `toolName`. [Draft events](https://webmachinelearning.github.io/webmcp/#events), [pinned algorithms, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

**EXPERIMENTAL — frame scope:** The `getTools` introductory prose says “this document and its descendants,” but its algorithm starts at the top traversable’s active document and enumerates inclusive descendant navigables. Thus the actual algorithm includes eligible parents/siblings as well as descendants, consistent with the official polyfill README. Treat this as a draft prose/algorithm discrepancy, not an excuse to erase frame identity. Tools execute on the owning document. Separate tabs are not included by this traversal. [Pinned source getTools algorithm, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs), [official polyfill README, commit de1eeff, 2026-10-27](https://github.com/webmachinelearning/webmcp-polyfill/blob/de1eeffdebacfe8d89209a16156c99f314ed4cee/README.md).

**EXPERIMENTAL — same/cross-origin:** Same-origin tools are included by default. Cross-origin callers need the owner’s registration `exposedTo: [callerOrigin]` and the caller’s discovery `fromOrigins: [ownerOrigin]`; same-origin tools remain included even when `fromOrigins` is given. Origins must parse and be potentially trustworthy, otherwise `SecurityError`. Execution rechecks the descriptor’s owner origin and exposure; discovery is not a durable authorization grant across navigation. The `tools` permissions-policy default allowlist is `self`; cross-origin frames require delegation. [Pinned source §4.2/§4.4, 2026-11-02](https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs).

### 1.5 Browser implementation status

**EXPERIMENTAL — Chrome:** [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp), last updated **2026-10-07**, announces an origin trial starting **Chrome 149** and local `chrome://flags/#enable-webmcp-testing`. [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp), accessed 2026-11-06, gives the earlier testing minimum **146.0.7672.0**. The latter is a historical entry minimum, not evidence that every current draft member works in Chrome 146.

**EXPERIMENTAL / UNVERIFIED — Chrome Status discrepancy:** [Feature 5117755740913664 JSON](https://chromestatus.com/api/v0/features/5117755740913664), updated **2026-11-02 16:04:35**, records developer-trial first milestone **146**, origin-trial first **149**, last **156** on desktop/Android/WebView, trial ID `4163014905550602241`, and `flag_name: "Experimental Web Platform features"`. However its browser summary simultaneously reports `Proposed`, `origintrial: false`, `is_released: false`, with no shipped milestone. The concrete trial stages and Chrome documentation support experimental availability; the contradictory summary prevents claiming a clean stable-shipping state or a precisely verified trial end date. The linked origin-trials landing page did not expose a usable trial record in the fetched response.

**UNVERIFIED — other engines:** Chrome Status records **No signal** for Firefox and Safari, not a proof that implementations do not exist. [Playwright’s official next docs](https://playwright.dev/docs/next/api/class-webmcp), accessed 2026-11-06, mention Firefox `dom.modelcontext.enabled` and `dom.modelcontext.testing.enabled`, Chromium `--enable-features=WebMCP`, and no WebKit implementation; that page still names `navigator.modelContext`. This is tooling documentation with API drift, not a verified Firefox shipping claim. Native Firefox/Safari release versions, Edge shipping version, and full current-draft interoperability were not confirmed from browser-vendor release sources. Do not describe “all non-Chromium browsers unsupported” as a proven fact.

### 1.6 Official and community polyfills — published packages checked

**EXPERIMENTAL — official upstream:** `webmachinelearning/webmcp-polyfill` now serves source whose package metadata names **`@w3c/webmcp-polyfill@0.1.0`** and repository `w3c-oss/webmcp-polyfill`; the README says W3C Open Source Program pilot. Fetched source HEAD: **de1eeffdebacfe8d89209a16156c99f314ed4cee, 2026-10-27**. npm publication and entry points were independently confirmed from the [registry](https://registry.npmjs.org/@w3c/webmcp-polyfill/0.1.0) and [published declarations](https://unpkg.com/@w3c/webmcp-polyfill@0.1.0/dist/index.d.ts). It exports `installWebMCP(): void`, the `WebMCP` type namespace, and an `./auto` side-effect entry point; it installs on `document` and preserves existing native implementations, including partial ones.

```ts
import { installWebMCP } from '@w3c/webmcp-polyfill'
installWebMCP()
// Alternative side-effect entry point: @w3c/webmcp-polyfill/auto
```

**EXPERIMENTAL — official scope/gaps:** The [README](https://github.com/webmachinelearning/webmcp-polyfill/blob/de1eeffdebacfe8d89209a16156c99f314ed4cee/README.md) targets `webmcp-types@0.1.9`: registration, discovery, execution, cancellation, `toolchange`, cross-frame exposure/filtering. It does not implement declarative forms, `toolactivated`, or `toolcancel`, and cannot supply native browser-agent integration. Install in each frame; native contexts do not participate in polyfill message channels. The fetched implementation reads `inputSchema` but does not read `outputSchema`, another reason not to infer full latest-draft coverage. These discovery APIs and `toolchange` are now draft APIs, not polyfill-only inventions.

**EXPERIMENTAL — MCP-B:** [MCP-B repository](https://github.com/WebMCP-org/npm-packages), HEAD **469bad289e3aee1d19a487c2c7820d2c54a82373**, explicitly says it is not an official W3C or MCP project. Registry versions fetched: [`@mcp-b/webmcp-polyfill@6.0.3`](https://registry.npmjs.org/@mcp-b/webmcp-polyfill/6.0.3) and [`@mcp-b/global@6.0.3`](https://registry.npmjs.org/@mcp-b/global/6.0.3). The polyfill’s [published exports](https://unpkg.com/@mcp-b/webmcp-polyfill@6.0.3/dist/index.d.ts) are `installWebMCP()` and `WebMCP` types; its vendored upstream core adds temporary declarative-form support (`SubmitEvent.agentInvoked`, `respondWith`). The global package’s [published exports](https://unpkg.com/@mcp-b/global@6.0.3/dist/index.d.ts) include `initializeWebModelContext(options?)`, `cleanupWebModelContext()`, transport configuration/types, and a side-effect initialization path. It layers MCP transports, prompts/resources and bridge behavior over the tool API; those are extensions, not WebMCP spec primitives. Both packages also export an `./iife` bundle path.

**EXPERIMENTAL / UNVERIFIED — provenance traps:** The npm package [`webmcp-polyfill@0.0.2`](https://registry.npmjs.org/webmcp-polyfill/0.0.2) points to `ripulio/web-mcp`, not the official project. Older official README search snippets still use the unscoped name; the live manifest/published `@w3c` declarations supersede them. An [August proposal to host an official polyfill](https://github.com/webmachinelearning/webmcp/issues/252) is historical, not evidence that no official polyfill exists today. No separate current GoogleChromeLabs demo-polyfill npm publication/export contract was confirmed; do not invent one.

## 2. Standard Schema and JSON Schema conversion

### 2.1 Current validation interface

**PUBLIC API — versioned baseline:** [`@standard-schema/spec@1.1.0` declarations](https://unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts), [official website](https://standardschema.dev/), and [repository commit 86764d849573fc9cbb7cc2f2195d224f22b812c7, 2026-09-24](https://github.com/standard-schema/standard-schema/tree/86764d849573fc9cbb7cc2f2195d224f22b812c7) agree on the interfaces. The package version is 1.1.0 while the protocol field remains `version: 1`. The following excerpts omit comments and inference utilities, retaining member types:

```ts
interface StandardTypedV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardTypedV1.Props<Input, Output>
}
declare namespace StandardTypedV1 {
  interface Props<Input = unknown, Output = Input> {
    readonly version: 1
    readonly vendor: string
    readonly types?: Types<Input, Output> | undefined
  }
  interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }
}
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}
declare namespace StandardSchemaV1 {
  interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    readonly validate: (
      value: unknown, options?: StandardSchemaV1.Options | undefined
    ) => Result<Output> | Promise<Result<Output>>
  }
  type Result<Output> = SuccessResult<Output> | FailureResult
  interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }
  interface FailureResult { readonly issues: ReadonlyArray<Issue> }
  interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }
  interface PathSegment { readonly key: PropertyKey }
  interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined
  }
}
```

**PUBLIC API — implications:** `types` is optional type information; runtime code must not require it to exist. Successful validation produces **Output**, which may differ from Input. Failure uses `issues`; do not use array length as the success discriminator. Paths may contain property keys or `{ key }` segments, including symbols, so they are not already JSON Pointer strings. Supporting async validators requires awaiting the union result. Standard Schema does not expose an AbortSignal, JSON Schema conversion, or a standard custom-error code field. [Published interface 1.1.0](https://unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts).

### 2.2 Standard JSON Schema exists now

**PUBLIC API — independent capability:** [Standard JSON Schema](https://standardschema.dev/json-schema) is a separate interface in the same **1.1.0** spec package, not a method added to `StandardSchemaV1.Props`. Its `~standard` can contain both `validate` and `jsonSchema`, but either capability can exist independently. [Published declarations](https://unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts):

```ts
interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardJSONSchemaV1.Props<Input, Output>
}
declare namespace StandardJSONSchemaV1 {
  interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    readonly jsonSchema: StandardJSONSchemaV1.Converter
  }
  interface Converter {
    readonly input: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>
    readonly output: (options: StandardJSONSchemaV1.Options) => Record<string, unknown>
  }
  type Target = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string)
  interface Options {
    readonly target: Target
    readonly libraryOptions?: Record<string, unknown> | undefined
  }
}
```

**PUBLIC API — guarantees/limits:** Converters are synchronous and may throw. `target` is required; 2020-12 and draft-07 support are strongly recommended, not guaranteed. The open string union admits future targets; unsupported ones should throw. Results are records, not schema-validator instances. [Official JSON Schema interface](https://standardschema.dev/json-schema), spec/package **1.1.0**, accessed 2026-11-06.

**PUBLIC API — community adapter is different:** [`@standard-community/standard-json@0.4.0`](https://unpkg.com/@standard-community/standard-json@0.4.0/README.md) exports `toJsonSchema` and `loadVendor`; it converts Standard Schema vendors using library-specific conversion logic and may require vendor dependencies (Zod 3: `zod-to-json-schema`; Valibot: `@valibot/to-json-schema`). It supports `io: 'input' | 'output'`; absent `io`, vendor defaults apply, and vendor-specific options can override it. This runtime adapter package is not the `StandardJSONSchemaV1` interface specification.

### 2.3 Vendor conversion behavior

**PUBLIC API — Zod 4.6.7:** Native `z.toJSONSchema(schema, options?)`; default target 2020-12, default side output, `io: 'input'` selects accepted input. A transform followed by a concrete output schema can describe that output; a black-box transform alone cannot reveal its return shape. `z.date`, `z.bigint`, `z.custom`, sets/maps, and other non-JSON types are unrepresentable by default; conversion throws. `unrepresentable: 'any'` emits `{}` (weakens the contract), and current docs also support a per-node function. Ordinary arbitrary refinements do not become executable JSON Schema predicates; supported built-in constraints convert. Zod’s type-preserving `.overwrite()` differs from `.transform()`. [JSON Schema docs](https://zod.dev/json-schema), [v4 release explanation](https://zod.dev/v4), [version](https://registry.npmjs.org/zod/4.6.7).

**PUBLIC API — Valibot 1.5.0 / converter 1.8.0:** Official separate package `@valibot/to-json-schema`, function spelling **`toJsonSchema`**. Default draft-07; also 2020-12/OpenAPI 3.0. `typeMode: 'input'` stops at the first transformation/second schema; `'output'` starts at the last schema and requires an explicit post-transform output schema; default `'ignore'` converts the whole pipeline. Unsupported JS-specific schemas/actions (Date, bigint, custom checks/transforms without JSON equivalents) default to throwing; `errorMode: 'warn' | 'ignore'` weakens/omits unsupported pieces, and overrides can describe deliberate wire representations. `toStandardJsonSchema(schema)` supplies the companion interface. [Published README 1.8.0](https://unpkg.com/@valibot/to-json-schema@1.8.0/README.md), [official guide](https://valibot.dev/guides/json-schema/), [integration guide](https://valibot.dev/guides/integrate-valibot/).

**PUBLIC API — ArkType 2.2.9:** Native **`.toJsonSchema()`**, default 2020-12, optional draft-07. Unsupported `morph`, `predicate`, `date`, bigint/symbol `domain`, custom `proto`, non-JSON `unit`, etc. throw unless a configurable `fallback` handles them. A fallback describing a Date as a string only describes a chosen encoding; it does not serialize the runtime object. Standard JSON Schema is implemented directly: `~standard.jsonSchema.input` converts `rawIn`, `output` converts `rawOut`. This supports side selection without guessing arbitrary function output shapes. [Configuration docs](https://arktype.io/docs/configuration), [2.2 announcement](https://arktype.io/docs/blog/2.2), [published implementation @ark/schema 0.56.8 used by arktype 2.2.9](https://unpkg.com/@ark/schema@0.56.8/out/roots/root.js).

**PUBLIC API — Effect 4.1.2 (current):** `Schema.toJsonSchemaDocument(schema)` emits `{ dialect, schema, definitions }` for Draft 2020-12, describing the **encoded side of the canonical JSON codec**, derived using `Schema.toCodecJson`. It is not a plain-schema return with identical semantics to v3 `JSONSchema.make`. `JsonSchema.toDocumentDraft07`/`toDocumentDraft04` convert dialects. Opaque declarations without structural JSON codecs can yield unconstrained schemas; best-effort conversion can approximate constraints. [Current v4 guide](https://effect.website/docs/v4/schema/json-schema), [published Schema declarations 4.1.2](https://unpkg.com/effect@4.1.2/dist/Schema.d.ts).

**PUBLIC API — Effect companion adapters:** `Schema.toStandardSchemaV1` and `Schema.toStandardJSONSchemaV1` are exported in 4.1.2 (note **JSON** capitalization). The latter’s input converter uses the original AST, output uses `SchemaAST.toType`, then each goes through canonical JSON conversion; the published implementation supports 2020-12/draft-07 and throws for other targets. Its declaration prose still calls the representation experimental although the function has `@stability stable`; record that inconsistency instead of treating the ecosystem interface as absent. [Published internal implementation](https://unpkg.com/effect@4.1.2/dist/internal/schema/standardSchema.js), [declarations](https://unpkg.com/effect@4.1.2/dist/Schema.d.ts). Native Date/bigint/custom values require the corresponding canonical encoding and runtime codec; arbitrary refinements cannot be universally preserved. **UNVERIFIED:** exact Date/bigint wire formats for every Effect schema variant were not exhaustively checked.

**PUBLIC API — Effect v3 compatibility:** The [v3 guide](https://effect.website/docs/v3/schema/json-schema) documents `JSONSchema.make` from `effect`, with schemas generated from encoded representations and annotations for unsupported cases. That is a separately versioned API; do not copy it into a v4 adapter unchanged. npm `prev` was **3.22.4**, while `latest` was **4.1.2**, on access date.

**PUBLIC API — design inference:** Require validation plus a verifiable conversion capability (or an explicit JSON Schema) when exposing tools. Use input-side JSON Schema for agent-provided parameters; pass the validator’s transformed output to handlers. Choose a JSON wire representation for results before advertising output schemas. Conversion success does not prove runtime validity or lossless translation. This recommendation follows the interfaces/vendor limitations above; it is not a claimed existing `webmcp-sdk` API.

## 3. oRPC contract-first design

**PUBLIC API — version boundary:** `orpc.unnoq.com` redirects to `orpc.dev`; npm [`@orpc/server`](https://registry.npmjs.org/@orpc/server) currently has `latest: 1.16.1`, `beta: 2.0.0-beta.48`. Stable major is **1**. [v1 documentation](https://v1.orpc.dev/docs/contract-first/define-contract) remains available. Current [v2 procedure-contract docs](https://orpc.dev/docs/contract/procedure) differ: metadata plugins, composition semantics, and no `.route` in the overview. Do not silently combine those examples with v1; v1 `.route(route: Route)` was independently confirmed in [published @orpc/contract 1.16.1 declarations](https://unpkg.com/@orpc/contract@1.16.1/dist/index.d.mts).

**PUBLIC API — flow:** `oc` from `@orpc/contract` describes validation, errors, and metadata without a handler; routers are nested contract objects. `implement(contract)` from `@orpc/server` produces matching implementers; `.handler` supplies logic and `.router` assembles/enforces the contract. `os` from `@orpc/server` is the implementation-first builder; a locally named `os = implement(contract)` in docs is an implementer, not the imported generic builder. [v1 define](https://v1.orpc.dev/docs/contract-first/define-contract), [v1 implement](https://v1.orpc.dev/docs/contract-first/implement-contract), **1.x**, accessed 2026-11-06.

**PUBLIC API — canonical docs snippets:** Four short excerpts below, whitespace normalized; unresolved surrounding names are supplied by their documentation examples. These are research quotes, not proposed library code.

1. Contract excerpt from [v1 Define Contract](https://v1.orpc.dev/docs/contract-first/define-contract), **1.x**:

```ts
import { oc } from '@orpc/contract'

export const exampleContract = oc
  .input(
    z.object({
      name: z.string(),
      age: z.number().int().min(0),
    }),
  )
  .output(
    z.object({
      id: z.number().int().min(0),
      name: z.string(),
      age: z.number().int().min(0),
    }),
  )
```

2. Implementer/handler/router excerpts from [v1 Implement Contract](https://v1.orpc.dev/docs/contract-first/implement-contract), **1.x**:

```ts
import { implement } from '@orpc/server'

const os = implement(contract) // fully replaces the os from @orpc/server

export const listPlanet = os.planet.list
  .handler(({ input }) => {
    // Your logic for listing planets
    return []
  })

const router = os.router({ // <-- Essential for full contract enforcement
  planet: {
    list: listPlanet,
    find: findPlanet,
    create: createPlanet,
  },
})
```

3. Typed context excerpt from [v1 Context](https://v1.orpc.dev/docs/context), **1.x**:

```ts
const base = os.$context<{ headers: Headers, env: { DB_URL: string } }>()

const getting = base
  .handler(async ({ context }) => {
    console.log(context.env)
  })
```

4. Error/middleware excerpt from [v1 Error Handling](https://v1.orpc.dev/docs/error-handling), **1.x**:

```ts
const base = os.errors({ // <-- common errors
  RATE_LIMITED: {
    data: z.object({
      retryAfter: z.number(),
    }),
  },
  UNAUTHORIZED: {},
})

const rateLimit = base.middleware(async ({ next, errors }) => {
  throw errors.RATE_LIMITED({
    message: 'You are being rate limited',
    data: { retryAfter: 60 }
  })
  return next()
})
```

**PUBLIC API — `.route`:** In v1, `.route({ method, path, successStatus })` configures OpenAPI routing and can be combined with contract `.input/.output`; multiple calls spread-merge route metadata. It is transport metadata, not an additional validation stage. [v1 routing docs](https://v1.orpc.dev/docs/openapi/routing), [contract declarations 1.16.1](https://unpkg.com/@orpc/contract@1.16.1/dist/index.d.mts). For a browser tool SDK, equivalent tool metadata can borrow the separation of concerns without inheriting HTTP concepts.

**PUBLIC API — context/middleware/errors:** `.$context<T>()` declares caller-supplied dependencies; `.use(middleware)` composes execution behavior, and middleware can supply refined context via `next({ context: ... })`. `.errors({...})` defines typed error data and exposes constructors through handler/middleware `errors`. `ORPCError(code, { message, data })` is the ordinary error class; matching declared errors can participate in typed handling. These structured error guarantees belong to oRPC’s runtime/transport, not to browser WebMCP callback rejection semantics. [v1 context](https://v1.orpc.dev/docs/context), [v1 errors](https://v1.orpc.dev/docs/error-handling), **1.x**. Design inference: explicitly translate declared application errors to a JSON payload if agents must receive their details.

## 4. TanStack DX patterns — brief

**PUBLIC API — versions observed:** npm latest tags on access: Query React **5.106.1**, Router React **1.170.46**, Form React **1.33.5**. Sources: [Query registry](https://registry.npmjs.org/@tanstack/react-query/latest), [Router registry](https://registry.npmjs.org/@tanstack/react-router/latest), [Form registry](https://registry.npmjs.org/@tanstack/react-form/latest). Live `latest` documentation is not an immutable version snapshot.

**PUBLIC API — typed options factories:** `queryOptions({...})` returns its options at runtime while preserving useful inference and associating the key with the result type. A parameterized user function can return it for hooks and imperative clients; spreading it permits local overrides. The verified React Query name is **`queryOptions`**, not `createQueryOptions`. The latter was not confirmed as a React Query core export. [Official options guide](https://tanstack.com/query/latest/docs/framework/react/guides/query-options), Query **5.106.1**. Design inference: a reusable definition helper can preserve types without registration side effects; choosing that name for this SDK is a design decision.

**PUBLIC API — Standard Schema:** Form supports compatible schemas directly in validators, avoiding per-library adapters, but intentionally submits **input** values rather than transformed schema output; parse separately when needed. Router accepts modern Standard Schema schemas directly in `validateSearch`; Zod 3 has `zodValidator` from `@tanstack/zod-adapter`, whereas Zod 4 can be passed directly. ArkType/Valibot likewise avoid adapters; Effect needs the appropriate Standard Schema wrapper, whose name changes by Effect major. [Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation), [Form submission](https://tanstack.com/form/latest/docs/framework/react/guides/submission-handling), [Router search params](https://tanstack.com/router/latest/docs/guide/search-params), versions above. Design inference: explicitly document whether handlers get validator input or output.

**PUBLIC API — core/adapters:** [`@tanstack/react-query` package manifest](https://github.com/TanStack/query/blob/main/packages/react-query/package.json), version **5.106.1**, depends on `@tanstack/query-core`. This demonstrates a framework-independent state/runtime core with framework-facing packages. Design inference: registration/lifecycle/validation can live in an SDK core, while framework adapters own effects and cleanup.

**PUBLIC API — global typing:** Router’s exported `Register` interface is augmented with `router: typeof router`; Query’s `Register` can set `defaultError` and key/meta types. This changes compile-time inference, not a runtime registry. [Router type safety](https://tanstack.com/router/latest/docs/guide/type-safety), [Query TypeScript](https://tanstack.com/query/latest/docs/framework/react/typescript), versions above. Design inference: make global augmentation optional if multiple independent tool sets must coexist.

## 5. MCP alignment — latest published revision

**PUBLIC API — revision:** `/specification/latest/server/tools` redirected to **2026-07-28** when fetched. The [published tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and [schema source](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/3c4d91b7e832d9b74338d56eed03403ccc662123/schema/2026-07-28/schema.ts) were checked; source HEAD **3c4d91b7e832d9b74338d56eed03403ccc662123**, committed **2026-11-03T04:33:04Z**. Label PUBLIC API here means published protocol surface, not W3C standardization.

**PUBLIC API — tool fields:** `Tool` extends base metadata (`name`, optional `title`) and icons metadata; optional `description`; required `inputSchema` with root `type: 'object'`; optional `outputSchema`, `annotations`, `_meta`. Schemas default to **2020-12** without explicit `$schema`. Current `outputSchema` can describe any JSON value, not only objects. [Versioned schema source, 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/3c4d91b7e832d9b74338d56eed03403ccc662123/schema/2026-07-28/schema.ts).

**PUBLIC API — annotations/results:** MCP annotations include optional `title`, `readOnlyHint` (default false), `destructiveHint` (true), `idempotentHint` (false), `openWorldHint` (true). `CallToolResult` has required `content: ContentBlock[]`, optional `structuredContent?: unknown` representing any JSON value, and optional `isError` default false. Author-originated tool errors SHOULD use `isError: true`; protocol failures such as missing tools use protocol errors. These are different contracts from WebMCP’s callback value/DOMExceptions. [Versioned schema source, 2026-07-28](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/3c4d91b7e832d9b74338d56eed03403ccc662123/schema/2026-07-28/schema.ts).

**PUBLIC API — naming:** MCP tools SHOULD have case-sensitive names of length 1–128 using only ASCII letters, digits, `_`, `-`, `.` and SHOULD be unique within a server. Aggregators can encounter collisions and should disambiguate across servers. Keep the normative distinction: MCP says SHOULD; WebMCP’s registration algorithm rejects invalid names. [MCP tool names, revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names).

## Sources and reproducibility index

Every URL below was fetched on **2026-11-06**. Version/date evidence is recorded in the corresponding topic above; unversioned docs reflect the live page seen that day. Source code/package artifacts were read without installing packages or writing research caches into the repository.

- WebMCP draft, 2026-11-02: https://webmachinelearning.github.io/webmcp/
- WebMCP pinned source, 6cd745a: https://github.com/webmachinelearning/webmcp/blob/6cd745ac8a186122bd3f4aeaeb1d6cfa820251d2/index.bs
- Raw spec source actually fetched: https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs
- WebMCP commit metadata: https://api.github.com/repos/webmachinelearning/webmcp/commits/main
- Chrome overview, updated 2026-10-07: https://developer.chrome.com/docs/ai/webmcp
- Chrome imperative docs, updated 2026-10-16: https://developer.chrome.com/docs/ai/webmcp/imperative-api
- Chrome modern guidance: https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp
- Chrome JS guidance: https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/agentic-javascript-tools
- Chrome Status feature: https://chromestatus.com/feature/5117755740913664
- Chrome Status machine-readable record: https://chromestatus.com/api/v0/features/5117755740913664
- Origin-trial landing page (insufficient details): https://developer.chrome.com/origintrials/
- Playwright next API (drift noted): https://playwright.dev/docs/next/api/class-webmcp
- Official-polyfill historical proposal: https://github.com/webmachinelearning/webmcp/issues/252
- Official polyfill source README: https://raw.githubusercontent.com/webmachinelearning/webmcp-polyfill/main/README.md
- Official polyfill package manifest: https://raw.githubusercontent.com/webmachinelearning/webmcp-polyfill/main/package.json
- Official polyfill implementation: https://raw.githubusercontent.com/webmachinelearning/webmcp-polyfill/main/src/index.ts
- Official published package: https://registry.npmjs.org/@w3c/webmcp-polyfill/0.1.0
- Official published exports: https://unpkg.com/@w3c/webmcp-polyfill@0.1.0/dist/index.d.ts
- Unrelated unscoped package: https://registry.npmjs.org/webmcp-polyfill/0.0.2
- MCP-B repository: https://github.com/WebMCP-org/npm-packages
- MCP-B global source: https://raw.githubusercontent.com/WebMCP-org/npm-packages/main/packages/global/src/index.ts
- MCP-B polyfill source: https://raw.githubusercontent.com/WebMCP-org/npm-packages/main/packages/webmcp-polyfill/src/index.ts
- MCP-B global published exports: https://unpkg.com/@mcp-b/global@6.0.3/dist/index.d.ts
- MCP-B polyfill published exports: https://unpkg.com/@mcp-b/webmcp-polyfill@6.0.3/dist/index.d.ts
- Standard Schema: https://standardschema.dev/
- Standard JSON Schema: https://standardschema.dev/json-schema
- Standard interfaces package 1.1.0: https://unpkg.com/@standard-schema/spec@1.1.0/dist/index.d.ts
- Standard Schema source revision: https://github.com/standard-schema/standard-schema/tree/86764d849573fc9cbb7cc2f2195d224f22b812c7
- Community JSON adapter 0.4.0: https://unpkg.com/@standard-community/standard-json@0.4.0/README.md
- Zod JSON Schema: https://zod.dev/json-schema
- Zod v4 transforms: https://zod.dev/v4
- Valibot JSON guide: https://valibot.dev/guides/json-schema/
- Valibot integration: https://valibot.dev/guides/integrate-valibot/
- Valibot converter 1.8.0: https://unpkg.com/@valibot/to-json-schema@1.8.0/README.md
- ArkType conversion config: https://arktype.io/docs/configuration
- ArkType 2.2 announcement: https://arktype.io/docs/blog/2.2
- ArkType package dependencies: https://unpkg.com/arktype@2.2.9/package.json
- ArkType published adapter: https://unpkg.com/@ark/schema@0.56.8/out/roots/root.js
- Effect v4 JSON Schema: https://effect.website/docs/v4/schema/json-schema
- Effect v3 JSON Schema: https://effect.website/docs/v3/schema/json-schema
- Effect 4.1.2 declarations: https://unpkg.com/effect@4.1.2/dist/Schema.d.ts
- Effect adapter implementation: https://unpkg.com/effect@4.1.2/dist/internal/schema/standardSchema.js
- oRPC stable version tags: https://registry.npmjs.org/@orpc/server
- oRPC stable contract declarations: https://unpkg.com/@orpc/contract@1.16.1/dist/index.d.mts
- oRPC v1 define: https://v1.orpc.dev/docs/contract-first/define-contract
- oRPC v1 implement: https://v1.orpc.dev/docs/contract-first/implement-contract
- oRPC v1 context: https://v1.orpc.dev/docs/context
- oRPC v1 errors: https://v1.orpc.dev/docs/error-handling
- oRPC v1 routing: https://v1.orpc.dev/docs/openapi/routing
- oRPC current v2 contracts: https://orpc.dev/docs/contract/procedure
- oRPC current implementation: https://orpc.dev/docs/contract/implementation
- TanStack options: https://tanstack.com/query/latest/docs/framework/react/guides/query-options
- TanStack Query types: https://tanstack.com/query/latest/docs/framework/react/typescript
- TanStack package separation: https://raw.githubusercontent.com/TanStack/query/main/packages/react-query/package.json
- TanStack Form validation: https://tanstack.com/form/latest/docs/framework/react/guides/validation
- TanStack Form submission: https://tanstack.com/form/latest/docs/framework/react/guides/submission-handling
- TanStack Router schemas: https://tanstack.com/router/latest/docs/guide/search-params
- TanStack Router registration: https://tanstack.com/router/latest/docs/guide/type-safety
- MCP latest redirect: https://modelcontextprotocol.io/specification/latest/server/tools
- MCP versioned tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MCP raw schema fetched: https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts
- MCP pinned schema: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/3c4d91b7e832d9b74338d56eed03403ccc662123/schema/2026-07-28/schema.ts
- Exact versions for all mentioned npm packages were checked using `https://registry.npmjs.org/<package>` and `/latest`; links to relevant records also appear inline.

## Addendum, 2026-11-10 (output validation re-check)

- **EXPERIMENTAL:** The WebMCP draft is now "Draft Community Group Report, **9 November 2026**" (repo `main` at `f2f2ae2`, 2026-11-09, "Fire `toolactivated` event after invoking execute (#371)"). `ModelContextTool` still declares `object outputSchema`. Quote: "Tool output is expected to conform to the provided schema, and agents may reject outputs that do not validate." No user-agent output validation is defined. An unserializable result maps to `OperationError`. <https://webmachinelearning.github.io/webmcp/>
- **EXPERIMENTAL:** `webmachinelearning/webmcp-polyfill` `main` at `042327b` (2026-11-09), package `@w3c/webmcp-polyfill@0.1.0` (npm latest 0.1.0): `grep -rn outputSchema` over the source and tests returns **no matches**. The README targets `webmcp-types@0.1.9` and does not mention `outputSchema`. Inference (not verified at runtime): the polyfill neither stores nor exposes output schemas.

## Addendum, 2026-11-10 (consumer identity re-check)

Source: WebMCP Draft CG Report, 9 November 2026 (<https://webmachinelearning.github.io/webmcp/>), all EXPERIMENTAL.

- `RegisteredTool` IDL: `required Window window;` ("The Window of the document that registered the tool") and `required USVString origin;` ("only meaningful when the tool is cross-origin"). It has no id, generation or registration handle. `getTools` sets `window` to "targetDocument's relevant global object".
- `executeTool` steps: targetWindow = tool's window, then targetDocument = its associated Document, then a same-origin check against the recorded origin (`NotFoundError`), then lookup `targetToolMap[toolName]` (`NotFoundError` if absent), then an exposure check. The per-*execution* `uuid` is internal. "tool unregistration followed by a quick re-registration of a tool with the same toolName but input schema is _not_ protected against" (issue #92).
- §6.3.4.2 advises callers to inspect `origin` and `window` "to disambiguate tools when multiple subframes or origins expose tools with the same name."
- `toolchange`: fired from register/unregister via "notify documents of a tool change" at the ModelContext of eligible documents. It has no payload, and "the timing between firing the toolchange event, and other tasks queued after this algorithm, cannot be relied upon."
- **UNVERIFIED inference:** under WebIDL/HTML conventions, the JS value of a `Window`-typed member is the browsing context's WindowProxy, which survives navigation. The spec text fetched does not address this.

## Addendum, 2026-11-11 (unregister during execution; subagent audit, spot-checked)

Spec `main` [`aa1b51cf`](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs), 2026-11-10. All EXPERIMENTAL (CG draft).

- **NORMATIVE** [unregister a tool, L635–667](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L635-L667): removes `tool map[tool name]`, then notifies (only if the owner is fully active). It touches no pending execution. **NOTE** L650–654: "Unregistering a tool does not cancel an execution that has already invoked its ToolExecuteCallback, including when the callback itself performs the unregistration."
- **NORMATIVE** [registration abort steps, L865–877](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L865-L877): unregister, then reject the *registration* promise with the abort reason. An already-aborted signal rejects before insertion (L847–849).
- **NORMATIVE** [callback invocation, L573–626](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L573-L626): a separate per-call controller. Settlement is guarded by the local execution map (L600, L622), not by the registry. [completion, L1166–1193](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L1166-L1193) resolves the caller, unless the pending entry is gone. **DEDUCTION:** after unregistration, the late result is delivered.
- **NORMATIVE** [executeTool signal, L1109–1123](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L1109-L1123): reject with the abort reason, then cancel in parallel. [cancel, L343–388](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L343-L388): removes the entries, aborts the callback's controller, fires `toolcancel`. The late result is ignored. Issue #299 (deliver the result after an abort) was closed, declined.
- **NORMATIVE + SILENT** [unload cleanup, L394–432](https://github.com/webmachinelearning/webmcp/blob/aa1b51cf61aef6ed849b0e9e732617fd57872757/index.bs#L394-L432):
  - target-only unload completes with "target document unloaded" (`AbortError`), but does **not** abort the callback controller;
  - caller-only unload cancels (abort + `toolcancel`);
  - same-document unload only removes the entry.
  - Whether the callback code itself continues is not specified.
- **Issues:**
  - #218 / PR #248 (merged 2026-08-19): preserve in-flight executions after unregistration.
  - #300 / PR #311: self-unregistration clarification.
  - #346 (open): ordering of parallel operations.
  - #92 is titled "Who owns the validation layer?" (open). The spec's fast re-registration note links to it.
- **POLYFILL** (`webmcp-polyfill` `main` `042327b`, 2026-11-08, static reading): registration abort deletes the tool, notifies, and does not touch running callbacks. Caller abort rejects with the reason, then aborts the callback controller if it is unfinished, and late results are dropped. **It fires no `toolcancel`** (unlike the spec).
