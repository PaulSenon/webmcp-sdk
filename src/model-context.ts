/**
 * Minimal structural types for the WebMCP `ModelContext` interface, as specified in the
 * WebMCP Draft Community Group Report of 2026-11-02 (webmachinelearning/webmcp
 * @ 6cd745a). EXPERIMENTAL: this is a CG draft, not a W3C standard. Browser support is
 * partial and flag- or origin-trial-gated. See docs/research.md.
 *
 * The SDK depends on these shapes **structurally** and never on a global type, so you
 * can pass the native object, `@w3c/webmcp-polyfill`, or a test double anywhere a
 * `ModelContextLike` is accepted.
 *
 * Notable facts from the draft that shape this SDK:
 * - Entry point is `document.modelContext` (secure contexts only). `navigator.modelContext`
 *   is a deprecated Chromium-era name, not part of the draft.
 * - `registerTool()` returns `Promise<undefined>`. Removal = aborting the `signal` passed at
 *   registration. There is no `unregisterTool`, `provideContext`, or `clearContext`.
 * - Duplicate names (per document) reject with `InvalidStateError`.
 * - `execute(input, { signal })` returns any JSON-serializable value. A callback rejection
 *   reaches the caller as an opaque `OperationError` and **its message is not forwarded**.
 *   That is why this SDK returns agent-facing failures in-band (see `ToolFailureResult`).
 * - Removing a tool does **not** cancel callbacks already running.
 * - The browser does not validate inputs or outputs against the schemas.
 */

/** WebMCP tool annotations (draft). These differ from MCP's annotation set. */
export interface ModelContextToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
  readonly consequentialHint?: boolean;
  readonly debugging?: boolean;
}

/** `ModelContextTool` dictionary (draft). */
export interface ModelContextTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly outputSchema?: object;
  readonly annotations?: ModelContextToolAnnotations;
  readonly execute: (input: object, options: { readonly signal: AbortSignal }) => Promise<unknown>;
}

/** `RegisteredTool` dictionary returned by discovery (draft). It carries no callable. */
export interface RegisteredTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly outputSchema?: object;
  /** The window of the document that owns the tool. */
  readonly window: Window;
  /** The owner document's origin, serialized. */
  readonly origin: string;
  readonly annotations?: ModelContextToolAnnotations;
}

/** The provider half of `ModelContext`: what the core SDK needs to register tools. */
export interface ModelContextLike {
  registerTool(
    tool: ModelContextTool,
    options?: { readonly signal?: AbortSignal; readonly exposedTo?: readonly string[] },
  ): Promise<undefined | void>;
}

/** The consumer half of `ModelContext` (draft §4.2): discovery, execution, change events. */
export interface ModelContextConsumerLike extends EventTarget {
  getTools(options?: { readonly fromOrigins?: readonly string[] }): Promise<readonly RegisteredTool[]>;
  /** Resolves to the JSON-serialized result **string**. */
  executeTool(
    tool: RegisteredTool,
    input?: object,
    options?: { readonly signal?: AbortSignal },
  ): Promise<string>;
}

/**
 * Returns `document.modelContext` when present, or `undefined` (SSR, workers, insecure
 * contexts, unsupported browsers). Never throws.
 */
export function getModelContext(): (ModelContextLike & Partial<ModelContextConsumerLike>) | undefined {
  // The one runtime helper implemented on purpose: it is trivial and has no fake-success
  // path. It either finds the object or reports `undefined`.
  if (typeof document === "undefined") return undefined;
  const mc = (document as Document & { modelContext?: unknown }).modelContext;
  return mc && typeof (mc as ModelContextLike).registerTool === "function"
    ? (mc as ModelContextLike & Partial<ModelContextConsumerLike>)
    : undefined;
}
