/**
 * `webmcp-sdk/consumer` (optional, evaluated design, separate from the core).
 *
 * For **in-page agents**: JavaScript running in a page that wants to discover the
 * WebMCP tools of that page and its frames, show them to an LLM, and call them. It wraps
 * the draft's consumer API (`modelContext.getTools()`, `executeTool()`, `toolchange`
 * event; EXPERIMENTAL). It adds no cross-origin capability: the browser's
 * `exposedTo`/`fromOrigins` checks and permissions policy remain the only authority.
 *
 * ## Identity model (read this before using refs)
 *
 * | concept     | what it is                                          | stable?                                   |
 * | ----------- | --------------------------------------------------- | ----------------------------------------- |
 * | `name`      | the provider's tool name, unique **per document**   | may repeat across frames                  |
 * | `title`     | display label                                       | may repeat anywhere                       |
 * | `key`       | name unique **within one snapshot** (for LLM tool lists) | can change when collisions appear/disappear |
 * | `ref`       | identity: source document + name + descriptor fingerprint | never reused for a different tool     |
 *
 * Invariants:
 * 1. A ref **never** reaches a different tool. If the source document is gone, the name
 *    is no longer registered, or the descriptor changed (schema, description...), a call
 *    with the old ref returns `{ kind: "stale" }` and **nothing is executed**.
 * 2. Re-registering an **identical** descriptor under the same name in the same document
 *    keeps the same ref. The browser exposes no registration instance id, so the two
 *    are indistinguishable. Refs are not durable handles: never persist them.
 * 3. A source is a document, not a window. A same-origin frame that navigates gets a new
 *    source, so old refs go stale. For cross-origin frames the SDK cannot see the document,
 *    so it only detects navigation when the origin or the descriptors change.
 * 4. The check happens before `executeTool`, and `executeTool` itself resolves by name on
 *    the owner document. A replacement that lands between the check and the browser's
 *    lookup cannot be ruled out. The window is a single task. The browser still rechecks
 *    origin and exposure.
 */
import type {
  AnyContract,
  InferToolInput,
  InferToolOutput,
  JSONSchema,
  ModelContextConsumerLike,
  ToolAnnotations,
  ToolFailure,
  ToolIssue,
} from "../index.js";
import { notImplemented } from "../not-implemented.js";

declare const refBrand: unique symbol;
/** Opaque tool identity. Compare with `===`. Do not parse or persist it. */
export type ToolRef = string & { readonly [refBrand]: true };

/** The document a tool lives in. */
export interface ToolSource {
  /** Catalog-local id, unique per observed document. */
  readonly id: string;
  readonly origin: string;
  /** `true` for the catalog's own document. */
  readonly isSelf: boolean;
  /** Short, provider-safe label used in collision keys, e.g. `"self"` or `"f2"`. */
  readonly label: string;
}

/** One discovered tool, normalized. Immutable; belongs to one snapshot. */
export interface DiscoveredTool {
  readonly ref: ToolRef;
  /** Unique within its snapshot. Use it as the tool name you give an LLM. */
  readonly key: string;
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string;
  /** `{ type: "object", properties: {} }` when the provider gave none. */
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema | undefined;
  readonly annotations: ToolAnnotations;
  readonly source: ToolSource;
  /** Same as `catalog.call(this.ref, input, options)`. */
  call(input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
}

/** An immutable view of all discovered tools at one point in time. */
export interface CatalogSnapshot {
  /** Increments on every observed change. */
  readonly version: number;
  /** Sorted by `key`. */
  readonly tools: readonly DiscoveredTool[];
  /** Looks up by `key` **in this snapshot**. The returned tool still calls through its ref. */
  get(key: string): DiscoveredTool | undefined;
}

/** Why a call did not produce a value. */
export type ToolCallError =
  /** The ref no longer matches a live tool. Nothing was executed. Refresh and re-plan. */
  | { readonly kind: "stale"; readonly message: string }
  /** The caller's signal aborted. The tool may still have run partially (cooperative cancellation). */
  | { readonly kind: "cancelled"; readonly message: string }
  /**
   * The tool returned a webmcp-sdk failure envelope (`{ error: ToolFailure }`). Only
   * recognized when the result matches that shape exactly. A non-SDK tool that returns
   * the same shape is indistinguishable.
   */
  | { readonly kind: "tool"; readonly failure: ToolFailure }
  /**
   * The browser rejected the call: `NotFoundError` (gone), `OperationError` (callback
   * threw; the reason is not forwarded), `DataError`, `AbortError` (owner unloaded),
   * `SecurityError`...
   */
  | { readonly kind: "rejected"; readonly domException: string; readonly message: string }
  /** Typed bindings only: no tool, or several tools, with the contract's name and no `pick`. Nothing was executed. */
  | { readonly kind: "unresolved"; readonly reason: "not_found" | "ambiguous"; readonly candidates: readonly ToolRef[] }
  /** Typed bindings only: the input failed the contract's input schema. Nothing was sent. */
  | { readonly kind: "input_invalid"; readonly issues: readonly ToolIssue[] }
  /** Typed bindings only: the result failed the contract's output schema. */
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
   * Builds the snapshot key. Default: `name` when unique in the snapshot, else
   * `${name}__${source.label}`. Results are de-duplicated with a numeric suffix.
   * Use it to satisfy an LLM provider's name rules (length, charset).
   */
  readonly formatKey?: (tool: { readonly name: string; readonly source: ToolSource; readonly collides: boolean }) => string;
}

/**
 * A live, framework-agnostic tool catalog. Its `subscribe`/`getSnapshot` pair is
 * compatible with React's `useSyncExternalStore`, Svelte stores, Vue `shallowRef` and so on.
 */
export interface ToolCatalog {
  getSnapshot(): CatalogSnapshot;
  /** Fires after each new snapshot (debounced on `toolchange`). Returns an unsubscribe function. */
  subscribe(listener: (snapshot: CatalogSnapshot) => void): () => void;
  /** Forces a `getTools()` round trip. */
  refresh(): Promise<CatalogSnapshot>;
  /** Calls a discovered tool by identity. Never throws; failures are values. */
  call(
    ref: ToolRef,
    input?: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ToolCallResult>;
  /**
   * Typed access for tools you **know** at compile time: you supply the contract, and the
   * SDK validates input before sending and output on return. Discovery cannot provide
   * static types, so the contract is a claim the SDK checks at runtime.
   *
   * Resolution is by **name** at call time (not a ref). With several matches across
   * documents, `pick` decides. Without `pick`, the call fails with `unresolved`/`"ambiguous"`.
   */
  bind<C extends AnyContract>(
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
 * Creates a catalog. Discovery starts immediately. The first snapshot is empty until
 * the first `getTools()` resolves.
 *
 * @example
 * const catalog = createToolCatalog();
 * catalog.subscribe(({ tools }) => {
 *   agent.setTools(tools.map((t) => ({
 *     name: t.key,
 *     description: t.description,
 *     parameters: t.inputSchema,
 *     execute: (args: unknown) => t.call(args),
 *   })));
 * });
 */
export function createToolCatalog(options?: ToolCatalogOptions): ToolCatalog {
  return notImplemented("createToolCatalog");
}
