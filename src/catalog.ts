/**
 * Discovering and calling the WebMCP tools available to this page, for in-page agents.
 * EXPERIMENTAL: built on the WebMCP draft's `getTools()`, `executeTool()` and `toolchange`.
 *
 * A catalog is an object you create and own. It keeps no global or shared state: names are
 * unique within one catalog instance, for its lifetime.
 */
import type { ToolAnnotations } from "./define.js";
import type { ToolFailure } from "./errors.js";
import type { ModelContextConsumerLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";
import type { JSONSchema } from "./schema.js";

/**
 * One discovered tool: a description you can hand to a model. It carries JSON Schema
 * only: a remote page's validators do not cross the page boundary.
 */
export interface CatalogTool {
  /**
   * The name to give the model and to pass back to `callTool`. It is issued by this catalog:
   * - unique within the catalog;
   * - `[A-Za-z0-9_-]`, at most `maxNameLength`;
   * - shaped `<namePrefix><source>__<tool name>`, e.g. `self__search` or `f1__search`.
   *
   * The source tag identifies the document the tool comes from (a window/frame at one
   * origin) and is added to every name. The name is stable for the catalog's lifetime,
   * including across unregister/re-register of the same tool.
   */
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string;
  /** `{ type: "object", properties: {} }` when the tool declared none. */
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema | undefined;
  readonly annotations: ToolAnnotations;
  /** The origin of the document that registered the tool. */
  readonly origin: string;
  /** `true` when the tool comes from the catalog's own document. */
  readonly isSameDocument: boolean;
  /** The tool's original WebMCP name, for display or debugging. Not unique across frames. */
  readonly webmcpName: string;
}

/** Why a call produced no value. `callTool` never throws; every variant has a `message`. */
export type ToolCallError =
  /** Not a name this catalog issued. Nothing was executed. */
  | { readonly kind: "unknown_tool"; readonly message: string }
  /** Issued by this catalog, but not available now (removed, frame gone, catalog disposed). Nothing was executed, and the call is never rerouted. */
  | { readonly kind: "unavailable"; readonly message: string }
  /** `input` is not a JSON object. Nothing was executed. */
  | { readonly kind: "invalid_arguments"; readonly message: string }
  /** The tool returned a failure envelope (e.g. its own `input_invalid`). `message` is `failure.message`. */
  | { readonly kind: "tool_failed"; readonly message: string; readonly failure: ToolFailure }
  /** The browser rejected the call: `AbortError` (your signal, or the owner unloaded), `OperationError` (the tool threw; reason not forwarded), `SecurityError`… */
  | { readonly kind: "rejected"; readonly message: string; readonly domException: string };

/** Result of `callTool`. Discovered tools have no static types, so `value` is `unknown`. */
export type ToolCallResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ToolCallError };

export interface ToolCatalogSnapshot {
  readonly status:
    | "idle" // nothing queried yet
    | "loading"
    | "ready"
    | "unsupported" // no WebMCP consumer API in this environment
    | "error"; // the browser rejected discovery (e.g. SecurityError for an invalid origin)
  /** Same array object until something changes. */
  readonly tools: readonly CatalogTool[];
  /** Set when `status` is `"error"`. */
  readonly error?: Error;
  /** Snapshot counter: increases with each applied discovery result. */
  readonly version: number;
}

export interface ToolCatalogOptions {
  /** Other origins to include (native `fromOrigins`). A request filter: owners must still expose their tools to you. */
  readonly fromOrigins?: readonly string[];
  /**
   * Used as-is when given. Default: `document.modelContext`, looked up when discovery starts
   * and again on each `getTools()` / `update()` while it is still missing.
   */
  readonly modelContext?: ModelContextConsumerLike;
  /** Maximum length of issued names. Default `64` (common provider limit). */
  readonly maxNameLength?: number;
  /**
   * Optional prefix added to every issued name, for apps that feed several catalogs (or
   * their own tools) to one model. The catalog recognizes the full prefixed names in
   * `isCatalogTool` / `callTool`, so no reverse mapping is needed. Default `""`.
   *
   * It must match `[A-Za-z0-9_-]*` (otherwise `createToolCatalog` throws a `TypeError`) and
   * be at most `maxNameLength / 2` long (otherwise a `RangeError`). Choosing prefixes that do
   * not overlap is up to the app: the SDK keeps no registry across catalogs.
   */
  readonly namePrefix?: string;
}

/**
 * A live view of the tools available to this page. Lazy: nothing happens until
 * `getTools()` is called or someone subscribes.
 */
export interface ToolCatalog {
  /** Queries now (native `getTools`), updates the snapshot, and returns the tools. */
  getTools(): Promise<readonly CatalogTool[]>;
  /** The latest result, synchronously. */
  getSnapshot(): ToolCatalogSnapshot;
  /**
   * For code that must react to changes (e.g. a UI list). The first subscriber starts
   * listening to `toolchange`. The listener is called on each new snapshot, not on
   * subscribe. Returns a function that stops **this** listener only; the catalog keeps running.
   */
  subscribe(listener: (snapshot: ToolCatalogSnapshot) => void): () => void;
  /**
   * `true` if this catalog issued `name`, now or in the past, including tools that have since
   * disappeared and names issued before `dispose()`. Use it to route a model's tool call to
   * this catalog. It says nothing about the arguments.
   */
  isCatalogTool(name: string): boolean;
  /**
   * Calls the tool currently registered under `name`. `input` is whatever the model sent:
   * `undefined` becomes `{}`, and a non-object gives `invalid_arguments`. The tool's own
   * page validates the arguments. A replaced tool is called in its current version. Never throws.
   */
  callTool(name: string, input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
  /** Changes the origins (compared by value); re-queries if they changed. */
  update(options: Pick<ToolCatalogOptions, "fromOrigins">): void;
  /** Ends the catalog: stops discovery, releases every subscriber. Later calls answer `unavailable`. */
  dispose(): void;
}

/** Creates a catalog you own. Throws `TypeError` / `RangeError` for an invalid `namePrefix`. */
export function createToolCatalog(options?: ToolCatalogOptions): ToolCatalog {
  return notImplemented("createToolCatalog");
}
