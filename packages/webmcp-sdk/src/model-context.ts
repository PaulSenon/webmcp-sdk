/**
 * Minimal structural types for WebMCP's `ModelContext` (`document.modelContext`), after the
 * WebMCP Draft Community Group Report (`main` at `aa1b51c`, 10 November 2026). EXPERIMENTAL: a CG draft, not a W3C
 * standard; browser support is partial (see docs/research.md).
 *
 * The SDK depends on these shapes structurally, so the native object, a polyfill such as
 * `@w3c/webmcp-polyfill`, or a test double can be passed wherever a `modelContext` option exists.
 */
import type { ToolAnnotations } from "./define.js";

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

/** Provider half: what registration needs. */
export interface ModelContextLike {
  /** Resolves when registered; aborting `signal` unregisters (draft). */
  registerTool(
    tool: ModelContextTool,
    options?: { readonly signal?: AbortSignal; readonly exposedTo?: readonly string[] },
  ): Promise<undefined | void>;
}

/** `RegisteredTool` dictionary returned by `getTools()` (draft). Carries no callable and no registration id. */
export interface RegisteredTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly outputSchema?: object;
  readonly annotations?: ToolAnnotations;
  /** The window of the document that registered the tool. */
  readonly window: Window;
  readonly origin: string;
}

/** Consumer half: discovery, execution, `toolchange`. */
export interface ModelContextConsumerLike extends EventTarget {
  getTools(options?: { readonly fromOrigins?: readonly string[] }): Promise<readonly RegisteredTool[]>;
  /** Resolves to the JSON-serialized result **string**. */
  executeTool(tool: RegisteredTool, input?: object, options?: { readonly signal?: AbortSignal }): Promise<string>;
}
