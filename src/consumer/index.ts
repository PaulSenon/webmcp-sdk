/**
 * `webmcp-sdk/consumer` (optional, EXPERIMENTAL, separate from the core).
 *
 * For **in-page agents**: JavaScript running in a page that wants to discover the WebMCP
 * tools of that page and its frames, show them to an LLM, and call them. It wraps the
 * draft's consumer API (`modelContext.getTools()`, `executeTool()`, `toolchange` event).
 * It adds no cross-origin capability: the browser's `exposedTo`/`fromOrigins` checks and
 * permissions policy remain the only authority.
 *
 * ## Identity model
 *
 * | concept      | what it is                                        | unique within | stable                                     |
 * | ------------ | ------------------------------------------------- | ------------- | ------------------------------------------ |
 * | `name`       | the provider's tool name                          | one document  | as long as the provider keeps it           |
 * | `title`      | display label                                     | nothing       | no                                         |
 * | `uniqueName` | name to give an LLM (`name`, or `name__f1` on collision) | one snapshot | until collisions appear or disappear |
 * | `id`         | catalog identity: observed source + name + descriptor fingerprint | the catalog | never reassigned to a different (source, name, descriptor) |
 *
 * The guarantees come in three levels. Only the first is a promise.
 *
 * **1. SDK guarantee: no remapping.** The catalog never resolves an `id` to a different
 * descriptor or to a different *observed* source. When the latest snapshot no longer
 * contains that exact (source, name, fingerprint), `call` returns `{ kind: "stale" }`
 * **without calling `executeTool`**.
 *
 * **2. Best-effort detection, not a promise.** The catalog only knows what the platform
 * shows it:
 * - **Same-origin frames:** a navigation replaces the `Document` object, so the source
 *   changes and old ids go stale.
 * - **Cross-origin frames:** the document is opaque. A navigation is noticed only if the
 *   origin or a descriptor changes. Navigating to a page with identical tools is invisible.
 * - **Re-registration:** an identical descriptor re-registered under the same name in the
 *   same document is indistinguishable from the original (the platform exposes no
 *   registration instance id). It keeps its id.
 *
 * **3. Platform limit: no atomic check-and-call.** The SDK compares against its latest
 * snapshot, then calls `executeTool`, which resolves the tool **by name** in the owner
 * document. A change that has not yet produced a `toolchange` event, or that lands between
 * the check and the browser's lookup, cannot be excluded. The browser still rechecks
 * origin and exposure at execution. Never persist ids, and treat any result as coming
 * from "the tool currently registered under that name in that frame".
 */
import type {
  AnyContract,
  InferToolInput,
  InferToolOutput,
  JSONSchema,
  ToolAnnotations,
  ToolFailure,
  ToolIssue,
} from "../index.js";
import { notImplemented } from "../not-implemented.js";

// ---------------------------------------------------------------------------
// Platform shapes (WebMCP draft 2026-11-02, §4.2; EXPERIMENTAL)
// ---------------------------------------------------------------------------

/** `RegisteredTool` dictionary returned by `getTools()`. It carries no callable. */
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
  readonly annotations?: ToolAnnotations;
}

/** The consumer half of `ModelContext`: discovery, execution, `toolchange` events. */
export interface ModelContextConsumerLike extends EventTarget {
  getTools(options?: { readonly fromOrigins?: readonly string[] }): Promise<readonly RegisteredTool[]>;
  /** Resolves to the JSON-serialized result **string**. */
  executeTool(
    tool: RegisteredTool,
    input?: object,
    options?: { readonly signal?: AbortSignal },
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

declare const idBrand: unique symbol;
/** Opaque catalog identity. Compare with `===`. Do not parse or persist it. */
export type ToolId = string & { readonly [idBrand]: true };

/** An observed document that owns tools. */
export interface ToolSource {
  /** Catalog-local id, unique per observed document (see identity model, level 2). */
  readonly id: string;
  readonly origin: string;
  /** `true` for the catalog's own document. */
  readonly isSelf: boolean;
  /** Short, provider-safe label used in collision names, e.g. `"self"` or `"f2"`. */
  readonly label: string;
}

/** One discovered tool, normalized. Immutable; belongs to one snapshot. */
export interface DiscoveredTool {
  readonly id: ToolId;
  /** Unique within its snapshot. Use it as the tool name you give an LLM. */
  readonly uniqueName: string;
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string;
  /** `{ type: "object", properties: {} }` when the provider gave none. */
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema | undefined;
  readonly annotations: ToolAnnotations;
  readonly source: ToolSource;
  /** Calls this tool by its `id`. Never throws; failures are values. */
  call(input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
}

/** An immutable view of all discovered tools at one point in time. */
export interface CatalogSnapshot {
  /** Increments on every observed change. */
  readonly version: number;
  /** Sorted by `uniqueName`. */
  readonly tools: readonly DiscoveredTool[];
  /** Looks up by `uniqueName` **in this snapshot**. The tool still calls through its `id`. */
  get(uniqueName: string): DiscoveredTool | undefined;
}

/** Why a call did not produce a value. */
export type ToolCallError =
  /** No live tool matches the id in the latest snapshot. `executeTool` was not called. Refresh and re-plan. */
  | { readonly kind: "stale"; readonly message: string }
  /** The caller's signal aborted. The tool may have run partially (cancellation is cooperative). */
  | { readonly kind: "cancelled"; readonly message: string }
  /**
   * The tool returned a webmcp-sdk failure envelope (`{ isError: true, error }` with a
   * known `kind`). A non-SDK tool that returns the same shape is indistinguishable.
   */
  | { readonly kind: "tool_failed"; readonly failure: ToolFailure }
  /**
   * The browser rejected the call: `NotFoundError` (gone), `OperationError` (callback threw;
   * the reason is not forwarded), `DataError`, `AbortError` (owner unloaded), `SecurityError`...
   */
  | { readonly kind: "rejected"; readonly domException: string; readonly message: string }
  /** Typed bindings: zero, or several, tools with the contract's name and no `pick`. Nothing was executed. */
  | { readonly kind: "unresolved"; readonly reason: "not_found" | "ambiguous"; readonly candidates: readonly ToolId[] }
  /** Typed bindings: the input failed the contract's input schema. Nothing was sent. */
  | { readonly kind: "input_invalid"; readonly issues: readonly ToolIssue[] }
  /** Typed bindings: the result failed the contract's output schema. */
  | { readonly kind: "output_invalid"; readonly message: string };

export type ToolCallResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ToolCallError };

export interface ToolCatalogOptions {
  /** Defaults to `document.modelContext`. */
  readonly modelContext?: ModelContextConsumerLike;
  /** Cross-origin owners to include (draft `fromOrigins`). Owners must also opt in via `exposedTo`. */
  readonly fromOrigins?: readonly string[];
  /**
   * Builds `uniqueName`. Default: `name` when unique in the snapshot, else
   * `${name}__${source.label}`. Results are de-duplicated with a numeric suffix. Use it
   * to satisfy an LLM provider's name rules (length, charset; WebMCP allows `.`, some
   * providers don't).
   */
  readonly formatName?: (tool: {
    readonly name: string;
    readonly source: ToolSource;
    readonly collides: boolean;
  }) => string;
}

/**
 * A live, framework-agnostic tool catalog.
 *
 * `subscribe` + `getSnapshot` follow the external-store contract of React's
 * `useSyncExternalStore`: `subscribe` does **not** call the listener immediately, and
 * `getSnapshot` returns the same object until something changes. Other frameworks need a
 * small adapter. Svelte stores, for instance, expect an immediate first call:
 * `readable(catalog.getSnapshot(), (set) => catalog.subscribe(set))`.
 */
export interface ToolCatalog {
  getSnapshot(): CatalogSnapshot;
  /** Called after each new snapshot (coalesced on `toolchange`). Not called on subscribe. Returns unsubscribe. */
  subscribe(listener: (snapshot: CatalogSnapshot) => void): () => void;
  /** Forces a `getTools()` round trip. */
  refresh(): Promise<CatalogSnapshot>;
  /**
   * Typed access for tools you **know** at compile time. You supply the contract, and the
   * SDK validates input before sending and output on return. Discovery cannot provide
   * static types, so the contract is a claim the SDK checks at runtime.
   *
   * Resolution is by **name at call time**, not by id: it means "whichever tool implements
   * this contract". With several matches across documents, `pick` decides. Without
   * `pick`, the call fails with `unresolved`/`"ambiguous"` and nothing runs.
   */
  bindContract<C extends AnyContract>(
    contract: C,
    options?: { readonly pick?: (candidates: readonly DiscoveredTool[]) => DiscoveredTool | undefined },
  ): BoundTool<C>;
  /** Stops listening. Further calls return `stale`. */
  dispose(): void;
}

export interface BoundTool<C extends AnyContract> {
  readonly contract: C;
  call(
    input: InferToolInput<C>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ToolCallResult<InferToolOutput<C>>>;
}

/**
 * Creates a catalog. Discovery starts immediately. The first snapshot is empty
 * (`version: 0`) until the first `getTools()` resolves.
 *
 * @example
 * const catalog = createToolCatalog();
 * catalog.subscribe(({ tools }) => {
 *   agent.setTools(tools.map((t) => ({
 *     name: t.uniqueName,
 *     description: t.description,
 *     parameters: t.inputSchema,
 *     execute: (args: unknown) => t.call(args),
 *   })));
 * });
 */
export function createToolCatalog(options?: ToolCatalogOptions): ToolCatalog {
  return notImplemented("createToolCatalog");
}
