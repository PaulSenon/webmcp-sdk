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
import { isToolFailureEnvelope } from "./errors.js";
import { defaultContext } from "./runtime.js";
import type { RegisteredTool } from "./model-context.js";
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
   * The source tag identifies the document the tool comes from: one window or frame **at one
   * origin**. A frame that navigates to another origin becomes a new source. The tag is added
   * to every name. Do not parse names (tool names and prefixes may contain `_`): use
   * `webmcpName`, `origin` and `isSameDocument` instead. The name is stable for the catalog's lifetime,
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

/**
 * Result of `callTool`. `value` is the tool's result, parsed from the JSON string WebMCP
 * returns. Discovered tools have no static types, so it is `unknown`.
 */
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
  /**
   * Queries now (native `getTools`), updates the snapshot, and returns the tools. Never
   * rejects: without WebMCP, or when the browser rejects discovery, it resolves `[]`, and the
   * snapshot's `status` (`"unsupported"` / `"error"`) says why.
   */
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
  const prefix = options?.namePrefix ?? "";
  const max = options?.maxNameLength ?? 64;
  if (!/^[A-Za-z0-9_-]*$/.test(prefix)) throw new TypeError("Invalid namePrefix charset.");
  if (prefix.length > max / 2) throw new RangeError("namePrefix exceeds half of maxNameLength.");
  let origins = [...new Set(options?.fromOrigins ?? [])].sort();
  let context = options?.modelContext;
  let listening: ModelContextConsumerLike | undefined;
  let disposed = false, queried = false, sequence = 0, frameCounter = 0;
  let active = 0, pendingEvent = false;
  let snapshot: ToolCatalogSnapshot = { status: "idle", tools: [], version: 0 };
  const subscribers = new Set<(snapshot: ToolCatalogSnapshot) => void>();
  const issued = new Set<string>();
  const sources = new WeakMap<Window, Map<string, { tag: string; names: Map<string, string> }>>();
  let current = new Map<string, RegisteredTool>();
  const ownWindow = typeof document === "undefined" ? undefined : document.defaultView;
  const publish = (next: Omit<ToolCatalogSnapshot, "version">) => {
    snapshot = { ...next, version: snapshot.version + 1 };
    for (const listener of subscribers) {
      try { listener(snapshot); } catch (error) { console.error("webmcp-sdk catalog subscriber threw", error); }
    }
  };
  const listen = () => {
    if (context && subscribers.size && !listening && !disposed) {
      context.addEventListener("toolchange", onChange); listening = context;
    }
  };
  const stop = () => { listening?.removeEventListener("toolchange", onChange); listening = undefined; pendingEvent = false; };
  const onChange = () => {
    if (active) pendingEvent = true;
    else void query();
  };
  const nameFor = (tool: RegisteredTool) => {
    let byOrigin = sources.get(tool.window);
    if (!byOrigin) { byOrigin = new Map(); sources.set(tool.window, byOrigin); }
    let source = byOrigin.get(tool.origin);
    if (!source) {
      // Only the first origin of our own window may use self; navigation is a new source.
      source = { tag: tool.window === ownWindow && !byOrigin.size ? "self" : `f${++frameCounter}`, names: new Map() };
      byOrigin.set(tool.origin, source);
    }
    const old = source.names.get(tool.name);
    if (old) return old;
    const head = `${prefix}${source.tag}__`;
    const normalized = tool.name.replace(/[^A-Za-z0-9_-]/g, "_");
    let suffix = "", n = 1, name: string;
    do {
      if (head.length + suffix.length >= max) throw new RangeError("maxNameLength cannot fit a source and tool name.");
      name = head + normalized.slice(0, max - head.length - suffix.length) + suffix;
      suffix = `_${++n}`;
    } while (issued.has(name));
    source.names.set(tool.name, name); issued.add(name);
    return name;
  };
  async function query(): Promise<readonly CatalogTool[]> {
    if (disposed) return [];
    queried = true;
    const seq = ++sequence;
    active++;
    // Initial loading is asynchronous so subscribe never invokes its listener inline.
    await Promise.resolve();
    if (seq === sequence && !disposed && snapshot.status === "idle") publish({ status: "loading", tools: snapshot.tools });
    try {
      context ??= defaultContext();
      listen();
      if (!context) {
        if (seq === sequence && !disposed) { current = new Map(); publish({ status: "unsupported", tools: snapshot.tools.length ? [] : snapshot.tools }); }
        return [];
      }
      const tools = await context.getTools({ fromOrigins: origins });
      if (seq !== sequence || disposed) return snapshot.tools;
      const registry = new Map<string, RegisteredTool>();
      const mapped = tools.map(tool => {
        const name = nameFor(tool);
        registry.set(name, tool);
        return { name, title: tool.title, description: tool.description,
          inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as JSONSchema,
          outputSchema: tool.outputSchema as JSONSchema | undefined, annotations: tool.annotations ?? {},
          origin: tool.origin, isSameDocument: tool.window === ownWindow, webmcpName: tool.name };
      });
      current = registry;
      const stable = JSON.stringify(mapped) === JSON.stringify(snapshot.tools) ? snapshot.tools : Object.freeze(mapped);
      publish({ status: "ready", tools: stable });
      return stable;
    } catch (error) {
      if (seq === sequence && !disposed) { current = new Map(); publish({ status: "error", tools: snapshot.tools.length ? [] : snapshot.tools,
        error: error instanceof Error ? error : new Error("Tool discovery failed.", { cause: error }) }); }
      return [];
    } finally {
      active--;
      if (!active && pendingEvent && subscribers.size && !disposed) { pendingEvent = false; void query(); }
    }
  }
  const failure = (error: ToolCallError): ToolCallResult => ({ ok: false, error });
  return {
    getTools: query,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      const first = !subscribers.size;
      subscribers.add(listener);
      if (first) { listen(); void query(); }
      return () => { subscribers.delete(listener); if (!subscribers.size) stop(); };
    },
    isCatalogTool: name => issued.has(name),
    async callTool(name, input, callOptions) {
      try {
        if (disposed) return failure({ kind: "unavailable", message: "The tool is no longer available." });
        if (!issued.has(name)) return failure({ kind: "unknown_tool", message: "Unknown tool name." });
        if (!queried) await query();
        const tool = current.get(name);
        if (!tool || !context) return failure({ kind: "unavailable", message: "The tool is no longer available." });
        if (input === undefined) input = {};
        if (!input || typeof input !== "object" || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null))
          return failure({ kind: "invalid_arguments", message: "Tool arguments must be a plain object." });
        const value: unknown = JSON.parse(await context.executeTool(tool, input, callOptions));
        return isToolFailureEnvelope(value) ? failure({ kind: "tool_failed", message: value.error.message, failure: value.error }) : { ok: true, value };
      } catch (error) {
        const name = error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
        return name === "NotFoundError" ? failure({ kind: "unavailable", message: "The tool is no longer available." })
          : failure({ kind: "rejected", message: "The browser rejected the tool call.", domException: name });
      }
    },
    update(next) {
      const value = [...new Set(next.fromOrigins ?? [])].sort();
      if (JSON.stringify(value) !== JSON.stringify(origins)) { origins = value; if (!disposed) void query(); }
    },
    dispose() { disposed = true; sequence++; stop(); subscribers.clear(); current.clear(); },
  };
}
