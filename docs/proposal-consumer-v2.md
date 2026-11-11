# Proposal: consumer v2, publisher v2, cleanup (for review, 2026-11-11)

Status: **proposal, not applied.** Types and README still show the current API. Nothing here needs runtime work. Spec, polyfill and license conclusions (D16, D19, MIT) are unchanged.

## 1. Why the README forced a `Map` on the user

The current catalog has **two strings per tool**:

- `id` (`self__search`): the catalog's identity, which may contain `.`, may exceed 64 characters, and is what `call(id)` accepts;
- `toProviderName(id)`: a *derived* provider-safe name that the catalog does **not** know.

The name sent to the model is therefore not something the catalog can resolve, so the caller had to keep `providerName → id`. The bug is architectural: **the catalog must issue the name it later resolves.**

## 2. Proposed model: one name, issued and resolved by the catalog

Each discovered tool gets exactly **one exposed `name`**:

- **unique within the catalog** and **provider-safe**: `[A-Za-z0-9_-]`, at most `maxNameLength` (default 64). That charset is the intersection of the common provider rules, so there is no per-provider regex option;
- **sticky:** assigned the first time an identity (source window + origin + WebMCP name, as in D13) is seen, and kept for the catalog's lifetime, including across unregister/re-register of that identity;
- **never reused** for another identity. If the tool disappears, its name is retired: calls return `unavailable`, never another tool.

Assignment uses no hash, so it cannot rely on hashes never colliding. Uniqueness comes from the catalog's own registry:

1. **Base:** the WebMCP name with invalid characters replaced by `_`, truncated.
2. **Taken by another identity:** try `${base}_${sourceKey}` (`search_f1`), then `${base}_2`, `_3`…, truncating the base so it still fits.
3. **First seen wins:** the first identity seen gets the plain name. Names depend on discovery order, so they are stable for a catalog's lifetime but not across page reloads. That is enough, because the model receives a fresh list with each request.

This **replaces** D13's always-prefixed ids and `toProviderName`. D13's identity rules (source = window + origin; same-origin navigation keeps the source; origin change gives a new source) are kept internally.

## 3. Proposed API (consumer only)

```ts nocheck
const catalog = createToolCatalog({ fromOrigins?, modelContext?, maxNameLength? });

await catalog.getTools();          // fresh query → readonly CatalogTool[]
catalog.getSnapshot();             // last result, sync (status, tools)
catalog.subscribe(listener);       // only for code that must react to changes (UI lists)

catalog.isCatalogTool(name);       // membership: was this name issued by this catalog? (current or retired)
catalog.isAvailable(name);         // availability: is it in the latest snapshot right now?
await catalog.callTool(name, input, { signal }); // never throws → ToolCallResult

await catalog.findByDefinition(definition);      // typed tools for definitions you know (unchanged idea)
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
| `input_invalid` / `output_invalid` | only via `findByDefinition` |

Why **two** predicates:

- `isCatalogTool` answers "is this tool call mine to route?". It stays `true` for a tool that disappeared, so the call is routed and answered with an explicit `unavailable`, instead of falling through to another handler.
- `isAvailable` is informative only: availability can change between the check and the call, so `callTool` decides anyway.

Neither predicate narrows the arguments' type. Runtime-discovered tools have no static types (`input: unknown`), and claiming otherwise would be a lie.

What the snapshot can and cannot be:

- **It is descriptions plus JSON Schema.** A remote page's validators cannot cross the page boundary, and the SDK never rebuilds validators from JSON Schema (D14).
- **It cannot be definitions or implementations.**
- **Typed calls** still require importing the shared `defineTool` definition (`findByDefinition`).

**Removed from the current API:** `id`, `DiscoveredTool.call`, `catalog.call(id)`, `toProviderName`, `find` (renamed `findByDefinition`), `not_found` (split into `unknown_tool` / `unavailable`).

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

## 6. Open points for the user (one at a time)

0. Publisher 5b: native-like `registerTool(impl, { signal })`, with reconciliation kept inside React?
1. Is the **single sticky exposed name** acceptable, given that the first-seen tool gets the plain name, so names depend on discovery order and are not stable across reloads?
2. **Predicate names:** `isCatalogTool(name)` (membership) and `isAvailable(name)` (availability)?

Everything else above is Opus's arbitration and can be applied to types and README once these are confirmed.
