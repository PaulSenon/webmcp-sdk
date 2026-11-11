# Proposal: consumer v2, publisher v2, cleanup (for review, 2026-11-11)

Status: **proposal, not applied.** Types and README still show the current API. Nothing here needs runtime work. Spec, polyfill and license conclusions (D16, D19, MIT) are unchanged.

## 1. Why the README forced a `Map` on the user

The current catalog has **two strings per tool**:

- `id` (`self__search`): the catalog's identity, which may contain `.`, may exceed 64 characters, and is what `call(id)` accepts;
- `toProviderName(id)`: a *derived* provider-safe name that the catalog does **not** know.

The name sent to the model is therefore not something the catalog can resolve, so the caller had to keep `providerName → id`. The bug is architectural: **the catalog must issue the name it later resolves.**

## 2. Proposed model: one name per tool, issued and resolved by the catalog (revised 2026-11-11, user direction)

**Source, in plain words:** the document a tool comes from, meaning one browser window or frame at one origin. Formally the pair (WindowProxy, origin). A frame that navigates to another origin counts as a new source.

Each discovered tool gets exactly **one name**. It is what the model sees and what `callTool` resolves, so callers need no map.

1. **Every tool of a source carries that source's tag, systematically.** The tag is assigned the first time the catalog sees the source, from a counter local to the catalog: `self` for the catalog's own document, then `f1`, `f2`… for other frames. It is never reused for another source.

   **Name = `<tag>__<tool name>`,** e.g. `self__search`, `f1__search`. It is a prefix, chosen so that every tool of one source groups together. Because the tag never depends on what else is registered, registration order is irrelevant: A's `toto` is always `f1__toto`.
2. **Same source + same WebMCP name gives the same name**, across unregister/re-register, for the catalog's lifetime.
3. **Provider-safe:** `[A-Za-z0-9_-]`, at most `maxNameLength` (default 64), including the tag.
   - Invalid characters become `_`.
   - The tool-name part is truncated when needed; the tag and prefix are never truncated.
4. **Collisions that the tag cannot prevent** happen inside **one** source, when two distinct WebMCP names normalize or truncate to the same string (`a.b` and `a_b`, or two long names sharing a prefix). The catalog's own registry resolves them: the first one seen keeps the plain normalized name, and the next gets `_2`, `_3`… (truncating further to fit). Assignments are sticky and never reused. There is no hash, so nothing assumes hashes never collide: uniqueness is checked against the registry.
5. **A source that disappears or changes origin** retires its names. Calls to them answer `unavailable` and are never rerouted, and the new origin gets a new tag.

**Scope: per catalog instance, no global state.** Tags, names and the registry live inside the instance you create. Two catalogs may assign different tags to the same frame. Combining them into one model is the app's choice and responsibility (§7).

This **revises D15**, which had a page-wide identity table so that ids matched across catalogs. That module-level table is dropped in favour of instance-owned state, per the "no hidden global state" preference.

- **In React:** `useToolCatalog` keeps one instance across re-renders and the StrictMode double effect (lazy `useState`). A remount creates a new catalog, so names may change. That is fine, because the model gets a fresh list per request.

**Stable for the catalog's lifetime only.** Reloads do not matter, and names are not meant to be persisted.

## 3. Proposed API (consumer only)

```ts nocheck
const catalog = createToolCatalog({ fromOrigins?, modelContext?, maxNameLength? });

await catalog.getTools();          // fresh query → readonly CatalogTool[]
catalog.getSnapshot();             // last result, sync (status, tools)
catalog.subscribe(listener);       // only for code that must react to changes (UI lists)

catalog.isCatalogTool(name);       // membership: was this name issued by this catalog? (current or retired)
catalog.isAvailable(name);         // availability: is it in the latest snapshot right now?
await catalog.callTool(name, input, { signal }); // never throws → ToolCallResult (see §10)
catalog.update({ fromOrigins });
catalog.dispose();                 // ends everything, including subscriptions
```

```ts nocheck
interface CatalogTool {
  readonly name: string;           // the one name: give it to the model, pass it back to callTool
  readonly title: string | undefined;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema | undefined;
  readonly annotations: ToolAnnotations;
  readonly origin: string;
  readonly isSameDocument: boolean;
  readonly webmcpName: string;     // the page's original name (display/debug only)
}
```

`callTool` errors (every one has a `message`):

| `kind` | meaning |
| ------ | ------- |
| `unknown_tool` | not a name this catalog issued (it belongs to someone else); nothing executed |
| `unavailable` | issued by this catalog, but not currently available (removed, frame gone); nothing executed, **never rerouted** |
| `tool_failed` | the tool returned a failure envelope (`failure` attached) |
| `rejected` | the browser rejected the call (`domException`) |
| `invalid_arguments` | `input` is not a JSON object (or `undefined`); nothing executed |

Why **two** predicates:

- `isCatalogTool` answers "is this tool call mine to route?". It stays `true` for a tool that disappeared, so the call is routed and answered with an explicit `unavailable`, instead of falling through to another handler.
- `isAvailable` is informative only: availability can change between the check and the call, so `callTool` decides anyway.

Neither predicate narrows the arguments' type. Runtime-discovered tools have no static types (`input: unknown`), and claiming otherwise would be a lie.

What the snapshot can and cannot be:

- **It is descriptions plus JSON Schema.** A remote page's validators cannot cross the page boundary, and the SDK never rebuilds validators from JSON Schema (D14).
- **It cannot be definitions or implementations.**
- **No typed consumer calls** (§10). Validation is the provider's job: a webmcp-sdk tool validates its input with its own definition and answers `input_invalid` in its envelope.

**Removed from the current API:** `id`, `DiscoveredTool.call`, `catalog.call(id)`, `toProviderName`, `find`/`KnownTool`, `not_found` (split into `unknown_tool` / `unavailable`), and the consumer-side `input_invalid` / `output_invalid`.

## 4. End-to-end: AI SDK (checked against `ai@7.0.169`, `@ai-sdk/react@4.0.173`, 2026-11-11)

WebMCP tools live **in the browser**. The model call usually runs **on a server** (API keys), which cannot reach `document.modelContext`. So:

- the browser sends the tool list with each request;
- the server declares those tools *without* `execute`;
- the model's tool call streams back to the browser;
- the browser runs it with `catalog.callTool` and sends the result back.

This is the AI SDK's documented client-side tool pattern (`onToolCall` + `addToolOutput` + `sendAutomaticallyWhen`).

```tsx nocheck
// app/chat.tsx (browser)
"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { createToolCatalog } from "webmcp-sdk";

const catalog = createToolCatalog(); // page lifetime: nothing to clean up

export function Chat() {
  const { messages, sendMessage, addToolOutput } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // A fresh snapshot with every request, including automatic resubmissions after tool results.
      body: async () => ({
        webmcpTools: (await catalog.getTools()).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall({ toolCall }) {
      if (!catalog.isCatalogTool(toolCall.toolName)) return; // another tool: not ours
      void catalog.callTool(toolCall.toolName, toolCall.input).then((result) =>
        result.ok
          ? addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: result.value })
          : addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, state: "output-error", errorText: result.error.message }),
      );
    },
  });
  // … render messages, call sendMessage({ text })
}
```

```ts nocheck
// app/api/chat/route.ts (server): no webmcp-sdk import needed
import { convertToModelMessages, createUIMessageStreamResponse, jsonSchema, streamText, tool, toUIMessageStream, type UIMessage } from "ai";

export async function POST(req: Request) {
  const { messages, webmcpTools }: { messages: UIMessage[]; webmcpTools: { name: string; description: string; inputSchema: object }[] } = await req.json();
  const result = streamText({
    model: /* your model */,
    messages: await convertToModelMessages(messages),
    // No `execute`: the browser runs these. The descriptions come from web pages, so treat them as untrusted input.
    tools: Object.fromEntries(webmcpTools.map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) })])),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
```

- **The user writes a shape adapter only** (`.map(...)` into the model's format). There is no map from names back to tools: the name the model returns is passed straight to `callTool`.
- **The core has no AI SDK dependency.** This is an example, not an adapter package.
- **Snapshot per request, not continuous sync.** `subscribe` stays available for UIs that list tools live.

## 5. Cleanup: one owner, one cleanup

The current README example (Registering tools) does this:

```ts nocheck
const unsubscribe = reg.subscribe(...); // observation
reg.unregister();                       // ends the registration
unsubscribe();                          // ends the observation, so two cleanups for one owner
```

It also mentions the `signal` option on the same line. Three things are mixed:

| operation | what it ends | who needs it |
| --------- | ------------ | ------------ |
| `reg.unregister()` / `catalog.dispose()` | **everything the handle owns**: the tools (or discovery) **and its listeners** | the owner, always |
| `signal` option | the same as `unregister()` / `dispose()`, triggered by an existing `AbortSignal` | owners who already have a lifecycle signal (a route, a component, an `AbortController`) |
| `unsubscribe()` | **one observer only**; the registration or catalog keeps running | a *different* piece of code that watches for a while and leaves, e.g. a status badge |

**Proposal:**

- **Superseded for the publisher if 5b is accepted:** publishing then has a single cleanup, `abort()`, and no observation at all. The rule below remains for the catalog.
- **`unregister()` and `dispose()` release all listeners** (no notification afterwards). So the nominal path has **one** cleanup:

  ```ts nocheck
  const registration = registerTools([searchTool, addToCartTool({ cart })]);
  // …
  registration.unregister(); // tools removed, observers released
  ```

- **Separate sections in the README:**
  - **"Registering"** shows only `registerTools` → `update` → `unregister` (plus one sentence: "or pass `{ signal }` to tie it to an existing `AbortSignal`").
  - **"Observing status"** shows `subscribe` with an *independent* observer:

  ```ts nocheck
  // A badge that watches the registration while it is visible
  const stopWatching = registration.subscribe(({ tools }) => badge.update(tools));
  badge.onClose(stopWatching); // the badge leaves; the tools stay registered
  ```

- **Catalog:** same rule (`dispose()` ends subscriptions). The AI SDK example needs neither, because a module-scope catalog lives as long as the page.
- **React:** hooks own both lifetimes. Users never call `unregister`, `dispose` or `unsubscribe`.
- **Publishing and discovery examples stay in separate sections.** No example mixes them.

## 5b. Publisher v2: map WebMCP 1:1, keep reconciliation inside React (exploratory)

**Guiding principle (user):** add quality of life, type-safety and DX where the native API is painful, map almost 1:1 where it is already trivial, and do not rebuild an abstraction without an obvious gain.

**Where native is painful, so the SDK adds value:** hand-written JSON Schema, no validation, opaque errors (`OperationError`), no types, `document.modelContext` missing (a crash unless you check), the `execute` result format. **Where native is already trivial:** lifetime. `registerTool(tool, { signal })` plus `abort()` is idiomatic, and the pass-2 handle (`update` / `unregister` / `subscribe` / `settled`) rebuilds a lifecycle the platform already has.

**Side by side:**

```ts nocheck
// Native WebMCP
const ac = new AbortController();
await document.modelContext?.registerTool(
  { name: "add_to_cart", description: "…", inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
    execute: async (input) => { /* validate by hand, return JSON, errors are opaque */ } },
  { signal: ac.signal },
);
ac.abort();

// SDK, plain TypeScript (proposed): same shape and lifetime, plus definitions, validation, types and the envelope
const ac = new AbortController();
const status = await registerTool(addToCartTool({ cart }), { signal: ac.signal }); // "registered" | "unsupported"
ac.abort();

// SDK, React (unchanged for users)
useRegisterTools([applyFilterTool({ dashboard }), pingTool]);
```

**Proposed core surface:**

- **`registerTool(implementation, options?) → Promise<"registered" | "unsupported">`**, with options `signal`, `exposedTo`, `modelContext`, `onUnexpectedError`. Like the native call:
  - **Rejects** on real failures (`WebMCPError`: `duplicate_name`, `json_schema_unavailable`, `registration_failed`).
  - **An already-aborted signal, or an abort while pending,** rejects with `signal.reason`.
  - **The one deliberate difference (D1):** no WebMCP resolves `"unsupported"` instead of crashing.
- **Lifetime = the `signal`, and nothing else.** No handle, no `update`, no publisher `subscribe` / `getSnapshot` / `settled`. The result of the promise *is* the status. This also removes the double-cleanup confusion on the publisher side: there is no observation to clean up.
- **Changing a handler or a definition in plain TS** works as it does natively: abort, then register the new implementation (or close over mutable state). The per-name ordering stays inside `registerTool`: a registration of a name waits for an SDK registration of the same name, whose signal was aborted, to finish settling (StrictMode, hot reload). It is invisible to users.
- **Grouping is not part of the core.** Several tools sharing one lifetime share one signal: `await Promise.all([a, b].map((t) => registerTool(t, { signal })))`. A `registerTools` helper would only add the compile-time duplicate check, so it is not worth a second name.

**React keeps reconciliation, internally.** React re-renders, recreates implementations through factories, and mounts and unmounts. `useRegisterTools(tools)` / `<RegisterTools>` therefore still need what D11 described:

- per-definition registrations, each with its own `AbortController`;
- handler refresh after commit, with no re-registration;
- abort-then-register for a changed definition;
- per-tool state for the UI.

That logic lives in the binding, built on `registerTool`. TypeScript users never see a reactive model.

**What changes in the decisions:**

- **D12 (core handle with `update`)** would be **withdrawn**.
- **D11's semantics** move into the React binding, as an implementation detail plus documented behaviour.
- **D16 and D19 are unchanged:** a running call is not cancelled by `abort`, and `modelContext` is the default context or one injected explicitly.
- **Collisions:** in plain TS, `duplicate_name` is the native rejection. In React it is per-tool state, retried when the conflicting **SDK** registration ends. A conflict with code outside the SDK stays an error until a later render or a remount, because the SDK cannot observe foreign removals reliably.

**How the two sides fit (consistent with the consumer feedback):**

- **Consumer:** the platform hands out raw refs, has no identity, and needs naming and routing, so the catalog absorbs real complexity.
- **Publisher:** the platform is already simple, so the SDK stays close to it.

**Open point for the user:** withdraw `registerTools(...).update(...)` in favour of `registerTool(impl, { signal })` (native-like) plus the React hooks?

## 5c. Publisher: one tool or a group, one cleanup (proposal, point 1: shape and cleanup)

**Need (user):** registering several tools at once is common, so plain TS must support one tool **and** a list. A group is registered in one operation and removed in one operation. Not requested: atomicity or rollback. No public `update`.

**Proposed shape: two names, the same options, the same cleanup.**

```ts nocheck
// one tool
const ac = new AbortController();
await registerTool(searchTool, { signal: ac.signal });   // "registered" | "unsupported"

// a group: one call, one lifetime
const shop = new AbortController();
const results = await registerTools([searchTool, addToCartTool({ cart }), checkoutTool], { signal: shop.signal });
// results: one entry per tool, in order: { name, status: "registered" | "unsupported" | "error", error? }

// removal: one call removes the whole group
shop.abort();
```

**Why two names rather than one overloaded function:** `registerTool` mirrors the native call, and `registerTools` reads as "several". Overloading one function on "item or array" saves a name but makes types and error messages murkier. The group version adds the compile-time duplicate-name check for literal arrays.

**Why `signal` as the only cleanup:**

- **Native:** it is the platform's own idiom, so the SDK adds nothing to learn.
- **One mechanism:** it works the same for one tool and for a group, so there is never a second cleanup (the earlier confusion).
- **Composable:** it plugs into existing lifetimes (a route's or component's `AbortController`, `AbortSignal.any([...])`, `AbortSignal.timeout`).
- **The alternative,** a returned `unregister()` handle, would mean two ways to do the same thing, or giving up `signal`, which every native caller already knows. Rejected.

**Compared with the user's alternative, a returned `unregister()` (2026-11-11):**

```ts nocheck
// A. Shared signal (native idiom)
const ac = new AbortController();
await registerTool(searchTool, { signal: ac.signal });
await registerTools([searchTool, checkoutTool], { signal: ac.signal });
ac.abort();                                              // one cleanup for everything registered with it

// B. Returned unregister
const { unregister } = await registerTools([searchTool, checkoutTool]);
unregister();
```

| criterion | A. `signal` | B. returned `unregister` |
| --------- | ----------- | ------------------------ |
| nominal code | one extra line (`new AbortController()`) | the shortest |
| cancelling while registration is still pending (unmount, navigation before the promise settles) | natural: `abort()` at any time, as in native | the function exists only after `await`, so the caller must wait and then undo, or the SDK needs a sync handle plus a promise (more concepts) |
| composing with an existing lifetime (route, component, `AbortSignal.any`, `timeout`) | direct: pass the existing signal | manual wiring (`signal.addEventListener("abort", unregister)`), or also accept `signal`, which means two ways to do one thing |
| several calls, one lifetime | same signal passed to each | one function per call to keep and call |
| consistency with native WebMCP | identical | a different model |
| failed `registerTool` (rejected) | nothing to clean up | nothing returned, so nothing to clean up |

**Arbitration: A, `signal` only.**

- **The decisive points are technical:** cancelling a pending registration, and plugging into lifetimes users already have. B's gain is one line.
- **Offering both** recreates the double-cleanup confusion.
- **A script that wants a function** writes `const unregister = () => ac.abort()`.
- **React users never see either,** because the hooks own the lifetime.

**Responsibilities:**

- **Whoever owns the `AbortController` owns the group.** Aborting removes every tool of the call that got registered. There is nothing to keep apart from the controller.
- **Several independent lifetimes** use several calls with different signals. Nothing is shared implicitly.
- **Running calls are not cancelled by `abort()`** (D16, native).

**Partial failure (no rollback, no transaction):**

- **`registerTools` never rejects for an individual tool.** It resolves once every tool has settled, with one result per tool, like `Promise.allSettled`, but typed and named.
- **The tools that succeeded stay registered** under the shared signal, and failed ones need no cleanup. If you want "all or nothing", check the results and call `abort()` yourself. That is one line, and opt-in.
- **`registerTool` (single) rejects** on failure, exactly like the native call (`WebMCPError`: `duplicate_name`, `json_schema_unavailable`, `registration_failed`).
- **Both:** no WebMCP resolves `"unsupported"` (D1). A signal that is already aborted, or aborted while registering, rejects with `signal.reason`, like the native call.

**React is unchanged:** `useRegisterTools([...])` / `<RegisterTools>` own their controllers internally (5b).

## 7. Several catalogs and other tools in the same model (decided, user 2026-11-11)

**Uniqueness is internal to one catalog, and nothing more.** There is no `namePrefix` option and no multi-catalog composition in the SDK (the earlier proposal is withdrawn).

- **Nominal path (one catalog per model):** the names it issues go straight to the model and straight back to `callTool`. No mapping is needed.
- **Deliberate composition** happens when an app feeds several catalogs, or a catalog plus non-WebMCP tools, to one model. The app renames in its own `getTools → provider` adapter, for example by adding its own prefix. Honest consequence: on the way back, **the app must strip its alias and pick the owning catalog itself, before** `isCatalogTool` / `callTool`, because the SDK only recognizes names it issued, never aliases added outside it. That bookkeeping exists only because the app chose to compose.
- **Ownership and lifetime are unchanged:** the issuing catalog owns its names until `dispose()`. After that, `isCatalogTool` is still `true` and `callTool` answers `unavailable`.
- **The systematic source tag (§2) is a different thing and stays:** it is how *one* catalog keeps the tools of different frames apart.

## 8. Narrowing tool calls, unknown vs known contracts (*level 2 withdrawn, see §10*)

The AI SDK hands the client `toolCall.toolName: string` and `toolCall.input: unknown` (dynamic tools). There are two honest levels:

**Level 1: membership only (any discovered tool).**

```ts nocheck
if (catalog.isCatalogTool(toolCall.toolName)) {
  const r = await catalog.callTool(toolCall.toolName, toolCall.input); // ToolCallResult<unknown>
}
```

`isCatalogTool` is a boolean about the **name** ("this catalog issued it"). It narrows nothing about the arguments, which stay `unknown`, and the provider page validates them.

**Level 2: a known contract (you import the same `defineTool` definition as the page).**

```ts nocheck
import { searchProducts } from "@shop/tool-definitions";

const tool = catalog.getTool(toolCall.toolName);          // latest snapshot entry, or undefined
if (tool?.webmcpName === searchProducts.name) {
  const r = await catalog.callTool(tool.name, toolCall.input, { definition: searchProducts });
  //    ^ ToolCallResult<{ hits: … }>: input validated locally first (nothing sent if invalid),
  //      result validated with the definition's output schema (transforms applied), so the type is earned at runtime
}
```

- **Static types come from the definition you import,** never from the discovered JSON Schema. The match is by name, which proves nothing about the contract, so `{ definition }` validates the actual values both ways:
  - **input:** a failure is `input_invalid`, and nothing is sent; the **original** input is sent when valid;
  - **output:** a failure is `output_invalid`.
- **A mismatch is an explicit error:** if the tool under that name is not `definition.name`, the result is `definition_mismatch`. It is never rerouted.
- **This replaces `findByDefinition`,** which is no longer needed: listing known tools is `tools.filter((t) => t.webmcpName === searchProducts.name)`.
- **New lookup `getTool(name)`:** a sync read of the latest snapshot. It does not check current availability, because `callTool` decides that.
- **No AI SDK coupling:** these are plain strings and `unknown`, which fit any framework.

**Is "`getTools()` → snapshot to the model → `callTool(name, args)`" the right design?** Yes, with these stated limits:

- **The snapshot can be stale by the time the model calls back.** A removed tool returns `unavailable`. A replaced tool (same identity, new descriptor) is called in its current version and validated (D17).
- **A model can invent names.** `isCatalogTool` is then `false`, or `callTool` returns `unknown_tool`.
- **Arguments are unknown** unless you bring the definition.
- **Names are unique per instance only** (§7).

## 9. ~~One `callTool`, two uses~~ (*withdrawn, see §10*)

**Need (user):** a pattern independent of the AI SDK for:

1. **an opaque tool call from a model:** route by name, with `unknown` input and output;
2. **a hand-written call with a contract known locally:** autocompletion, input inferred from what you call, matching output.

**Key constraint:** the names the catalog exposes (`search_products`, `search_products_f1`) are assigned **at runtime**, so they cannot be string literals in types. What is known statically is the **definition** you import. A string-keyed typed API (`callTool("search_products", …)`) would also need a registry of definitions passed to the catalog, and a loose `string` overload next to it would silently accept wrong arguments for a known name whenever the typed overload fails. **Rejected.**

**Proposal: discriminate by the type of the first argument.**

```ts nocheck
// 1. opaque (model): exposed name, unknown in and out
const r1 = await catalog.callTool(toolCall.toolName, toolCall.input);                    // ToolCallResult<unknown>

// 1b. opaque, but you recognize the contract: validate both ways, type the output
const r2 = await catalog.callTool(toolCall.toolName, toolCall.input, { definition: searchProducts }); // ToolCallResult<{ hits: … }>

// 2. manual, known contract: definition first, typed input and output
const r3 = await catalog.callTool(searchProducts, { q: "red shoes" });                    // input typed, output typed
await catalog.callTool(searchProducts, { q: "x" }, { origin: "https://widgets.example" }); // pick a source
```

- **No silent fallback.** A definition object can never match the `string` overload, so wrong arguments for a known contract are a compile error. Verified with a type probe on TS 7.0.2:
  - `callTool(searchProducts, { query: "x" })` is rejected;
  - `callTool(searchProducts, {})` is rejected (missing `q`);
  - opaque calls accept anything, and the result stays `unknown`.
- **Resolution for form 2:** the tools in the latest snapshot whose `webmcpName === definition.name`, optionally filtered by `origin`.
  - **One match:** it is called, with input validated locally and output validated.
  - **None:** `unavailable`.
  - **Several:** `ambiguous` (the error carries the candidate names). It never picks one silently. Pass `origin` to choose.
- **Form 1b** is §8 unchanged: the name pins the exact tool the model chose, and a different `webmcpName` gives `definition_mismatch`.
- **The contract source is explicit:** the definition you import (shared package, same module as the page). Discovery alone never produces types.
- **Real value of form 2, challenged:**
  - **Same document:** code can usually call its own functions directly, so the value is small.
  - **Cross-frame:** a host page driving a widget's tools with a shared definitions package. Here the value is real: typed, validated, no name bookkeeping.
  - **Cost:** one overload, no registry, no new concept. **Kept.**
- **Planned type tests (negative):**
  - wrong or missing fields with a definition;
  - the result type for each form;
  - `origin` only allowed with a definition.

## 10. Decision (user steering, 2026-11-11): one dynamic `callTool`, no typed consumer calls

**Withdrawn:**

- `callTool(definition, input)` (§9);
- `callTool(name, input, { definition })` (§8 level 2);
- the `getTool` lookup they needed.

**Why:** a definition is a static **contract**, while a discovered tool is a runtime **instance**. One catalog can hold several instances of the same contract (several origins, or several windows of the same origin), so a definition cannot designate the instance to call, and an origin cannot either (two frames, one origin). Making both target and contract explicit would mean extra API for a manual case nobody has asked for. **Not replaced** by any bind, find or typed registry.

**The consumer API is the dynamic path:**

```ts nocheck
callTool(name: string, input?: unknown, options?: { signal?: AbortSignal }): Promise<ToolCallResult>;

type ToolCallResult =
  | { ok: true; value: unknown }   // the tool's (validated, on the provider side) JSON result
  | { ok: false; error: ToolCallError };

type ToolCallError =               // every variant has `message`
  | { kind: "unknown_tool"; message: string }       // not a name this catalog issued; nothing executed
  | { kind: "unavailable"; message: string }        // issued, but not currently available; nothing executed; never rerouted
  | { kind: "invalid_arguments"; message: string }  // `input` is not a JSON object; nothing executed
  | { kind: "tool_failed"; message: string; failure: ToolFailure } // the tool's failure envelope (e.g. its own `input_invalid`)
  | { kind: "rejected"; message: string; domException: string };   // the browser rejected the call
```

- **`input: unknown`, not `Record<string, unknown>`.** Model frameworks hand over `unknown` (the AI SDK's `toolCall.input` is `unknown`), so callers need no cast. The object requirement is checked at runtime: `undefined` becomes `{}`, and a non-object becomes `invalid_arguments` with nothing sent. That is honest, because the type does not pretend to know the arguments.
- **`value: unknown`:** discovered tools have no static types. The provider side still validates: a webmcp-sdk tool runs its input and output schemas, and its failures arrive as `tool_failed` with the envelope.
- **`isCatalogTool(name)` is about the name only.** It routes and narrows nothing about the arguments.
- **Settled since:** naming (§2, revised) and scope (§7, decided).

## 6. Open points (audit 2026-11-11)

Settled:

- **Publisher (5b, 5c):** `registerTool` / `registerTools`, with `{ signal }` as the only cleanup (arbitration delegated by the user), per-tool results for groups, and reconciliation internal to React.
- **Consumer:** naming with a systematic source tag (§2), uniqueness internal to one catalog (§7), a single dynamic `callTool(name, input: unknown)` (§10), and cleanup through `dispose()` (§5).

Still open, one question:

1. **Predicate names and need:** `isCatalogTool(name)` (membership, which routes) and `isAvailable(name)` (current availability, informative only). Keep both, or only `isCatalogTool`, since `callTool` already answers `unavailable`?

Everything else above is Opus's arbitration and can be applied to types and README once these are confirmed.
