/**
 * Discovering and calling tools from an in-page agent. EXPERIMENTAL: built on the WebMCP
 * draft's `getTools()`, `executeTool()` and `toolchange`, which may still change.
 */
import type { AnyToolDefinition, InferToolInput, InferToolOutput, ToolAnnotations } from "./define.js";
import type { ToolFailure, ToolIssue } from "./errors.js";
import type { ModelContextConsumerLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";
import type { JSONSchema } from "./schema.js";

/** The document a tool comes from. */
export interface ToolSource {
  /** `"self"` for this document, `"f1"`, `"f2"`… for others. Assigned once per (window, origin) for the page's lifetime, never reused. */
  readonly key: string;
  readonly isSelf: boolean;
  readonly origin: string;
}

/**
 * Why a call produced no value. Failures are values: `call` never throws. Every variant
 * has a `message` you can hand to an LLM as-is.
 */
export type ToolCallError =
  /** No tool with this id in the latest discovery result, or the browser reports it gone. Nothing was executed. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The tool returned a failure envelope (webmcp-sdk tools, or any tool using the same shape). `message` is `failure.message`. */
  | { readonly kind: "tool_failed"; readonly message: string; readonly failure: ToolFailure }
  /** The browser rejected the call: `AbortError` (your signal, or the owner unloaded), `OperationError` (the tool threw; reason not forwarded), `SecurityError`… */
  | { readonly kind: "rejected"; readonly message: string; readonly domException: string }
  /** Known definitions only: your input failed the definition's input schema. Nothing was sent. */
  | { readonly kind: "input_invalid"; readonly message: string; readonly issues: readonly ToolIssue[] }
  /** Known definitions only: the result failed the definition's output schema. */
  | { readonly kind: "output_invalid"; readonly message: string };

export type ToolCallResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ToolCallError };

/** One discovered tool. Its types are unknown: discovery happens at runtime. */
export interface DiscoveredTool {
  /**
   * Stable, opaque id for this page session, e.g. `"self__search"`, `"f1__search"`. Use it as
   * an opaque string: do not parse it, because names may contain `_`. Never persist it.
   */
  readonly id: string;
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string;
  /** `{ type: "object", properties: {} }` when the tool declared none. */
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema | undefined;
  readonly annotations: ToolAnnotations;
  readonly source: ToolSource;
  /** Same as `catalog.call(this.id, input, options)`. */
  call(input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
}

/** A discovered tool matched to a definition you know: typed, and checked at runtime. */
export interface KnownTool<D extends AnyToolDefinition> extends Omit<DiscoveredTool, "call"> {
  /**
   * Validates `input` locally against the definition first (nothing is sent if it fails),
   * then sends **your original value**, not the parsed one, because the provider validates
   * again. Finally it validates the result with the definition's output schema.
   */
  call(
    ...args: [D["input"]] extends [undefined]
      ? [input?: InferToolInput<D>, options?: { readonly signal?: AbortSignal }]
      : [input: InferToolInput<D>, options?: { readonly signal?: AbortSignal }]
  ): Promise<ToolCallResult<InferToolOutput<D>>>;
}

export interface ToolCatalogSnapshot {
  readonly status:
    | "idle" // nobody subscribed yet and getTools() not called
    | "loading"
    | "ready"
    | "unsupported" // no consumer API in this environment
    | "error"; // the browser rejected discovery, e.g. SecurityError for an invalid origin
  /** Sorted by id. Same array object until something changes. */
  readonly tools: readonly DiscoveredTool[];
  /** Set when `status` is `"error"`, usually a `DOMException` from the browser. */
  readonly error?: Error;
  /** Snapshot counter: increases with each applied discovery result. It is not a tool revision. */
  readonly version: number;
}

export interface ToolCatalogOptions {
  /** Other origins to include (native `fromOrigins`). A request filter: owners must still expose their tools to you. */
  readonly fromOrigins?: readonly string[];
  /** Defaults to `document.modelContext`. */
  readonly modelContext?: ModelContextConsumerLike;
}

/**
 * A live view of the tools available to this page. Lazy: nothing happens until someone
 * subscribes or calls `getTools()`, so it is safe to create anywhere.
 */
export interface ToolCatalog {
  /** Queries now (native `getTools`) and returns the result. It also updates the snapshot, unless a newer query already did. */
  getTools(): Promise<readonly DiscoveredTool[]>;
  getSnapshot(): ToolCatalogSnapshot;
  /**
   * Calls `listener` with each new snapshot. The first subscriber starts discovery and listens
   * to `toolchange`, and the last one leaving stops it. Not called on subscribe. Returns an
   * unsubscribe function.
   */
  subscribe(listener: (snapshot: ToolCatalogSnapshot) => void): () => void;
  /** Changes the origins. Compared by value; re-queries only if they changed. */
  update(options: Pick<ToolCatalogOptions, "fromOrigins">): void;
  /**
   * Calls the tool currently registered under `id` (a replaced tool is called in its
   * current version, and the provider validates). If nothing has been discovered yet, it
   * runs a discovery first. Never throws.
   */
  call(id: string, input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
  /** Discovered tools whose name is `definition.name`, typed by it. Several sources may match; you choose. */
  find<D extends AnyToolDefinition>(definition: D): Promise<readonly KnownTool<D>[]>;
  /** Stops listening. Later calls return `not_found`. */
  dispose(): void;
}

/** Creates a catalog. See {@link ToolCatalog}. */
export function createToolCatalog(options?: ToolCatalogOptions): ToolCatalog {
  return notImplemented("createToolCatalog");
}

/**
 * Maps an id to a name an LLM provider accepts. Defaults: `maxLength: 64`,
 * `pattern: /^[a-zA-Z0-9_-]+$/` (common provider rules). Deterministic.
 * It sanitizes and truncates, and appends a short hash whenever it changed the id, so
 * distinct ids stay distinct. Keep your own `providerName → id` map to route calls back.
 */
export function toProviderName(id: string, options?: { readonly maxLength?: number; readonly pattern?: RegExp }): string {
  return notImplemented("toProviderName");
}
