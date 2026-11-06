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
 *   That is why this SDK returns agent-facing failures in-band (see `ToolFailureEnvelope`).
 * - The consumer half (`getTools`, `executeTool`, `toolchange`) is typed in
 *   `webmcp-sdk/consumer`, not here.
 * - Removing a tool does **not** cancel callbacks already running.
 * - The browser does not validate inputs or outputs against the schemas.
 */

import type { ToolAnnotations } from "./contract.js";
import { notImplemented } from "./not-implemented.js";

/** `ModelContextTool` dictionary (draft). */
export interface ModelContextTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly outputSchema?: object;
  readonly annotations?: ToolAnnotations;
  readonly execute: (input: object, options: { readonly signal: AbortSignal }) => Promise<unknown>;
}

/** The provider half of `ModelContext`: what the core SDK needs to register tools. */
export interface ModelContextLike {
  registerTool(
    tool: ModelContextTool,
    options?: { readonly signal?: AbortSignal; readonly exposedTo?: readonly string[] },
  ): Promise<undefined | void>;
}

/**
 * Intended behaviour: returns `document.modelContext` when present, or `undefined` (SSR,
 * workers, insecure contexts, unsupported browsers). Never throws.
 *
 * Prototype: not implemented, throws `NotImplementedError` like every other runtime entry point.
 */
export function getModelContext(): ModelContextLike | undefined {
  return notImplemented("getModelContext");
}
