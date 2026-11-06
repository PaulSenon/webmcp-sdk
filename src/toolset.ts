import type { AnyToolImplementation, InferToolContext } from "./implement.js";
import type { ModelContextLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";
import type { JSONSchemaTarget } from "./schema.js";
import type { ToolDescriptor } from "./contract.js";

// ---------------------------------------------------------------------------
// Type-level helpers
// ---------------------------------------------------------------------------

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/** The merged context every tool in the list requires (intersection). */
export type ToolsetContext<TTools extends readonly AnyToolImplementation[]> =
  TTools extends readonly []
    ? {}
    : UnionToIntersection<InferToolContext<TTools[number]>> extends infer Ctx
      ? { [K in keyof Ctx]: Ctx[K] }
      : never;

type FindDuplicate<
  TTools extends readonly AnyToolImplementation[],
  Seen extends string = never,
> = TTools extends readonly [
  infer Head extends AnyToolImplementation,
  ...infer Rest extends readonly AnyToolImplementation[],
]
  ? string extends Head["name"]
    ? FindDuplicate<Rest, Seen> // non-literal names can only be checked at runtime
    : Head["name"] extends Seen
      ? Head["name"]
      : FindDuplicate<Rest, Seen | Head["name"]>
  : never;

/**
 * Resolves to `unknown` (no constraint) when tool names are unique. Otherwise it resolves to a readable
 * compile error. Literal names are checked here. Computed names are checked at registration.
 */
export type UniqueToolNames<TTools extends readonly AnyToolImplementation[]> =
  [FindDuplicate<TTools>] extends [never]
    ? unknown
    : { readonly "~error": `Duplicate tool name "${FindDuplicate<TTools>}" in toolset` };

// ---------------------------------------------------------------------------
// Toolset and registration
// ---------------------------------------------------------------------------

/**
 * Where a registration stands.
 * - `registered`: every tool in the toolset is live.
 * - `unsupported`: no WebMCP in this environment and `ifUnsupported: "skip"` was set. Nothing registered.
 * - `unregistered`: `unregister()` was called or the `signal` aborted. Terminal.
 */
export type RegistrationState = "registered" | "unsupported" | "unregistered";

/** A registration of one toolset in one document. */
export interface ToolsetRegistration {
  readonly state: RegistrationState;
  /** Descriptors as sent to the browser (resolved JSON Schemas). Empty when `unsupported`. */
  readonly descriptors: readonly ToolDescriptor[];
  /**
   * Removes every tool of this registration (by aborting the registration signal the SDK
   * passed to `registerTool`). Synchronous and idempotent.
   *
   * In-flight calls get their handler `signal` aborted. The browser itself does not
   * cancel running callbacks on removal.
   */
  unregister(): void;
}

/** Options for registering a toolset. */
export type RegisterOptions<TContext> = {
  /**
   * Called **once per tool call**, just before the handler runs, so handlers always see
   * the current value and never a stale one. It may be async.
   * Required when any tool in the toolset declared a context with `$context<T>()`.
   */
  readonly context?: () => TContext | Promise<TContext>;
  /**
   * Aborting this signal unregisters the toolset, like `unregister()`. If it aborts
   * while `register()` is still pending, nothing stays registered and the promise
   * rejects with `signal.reason` (standard DOM behaviour).
   */
  readonly signal?: AbortSignal;
  /**
   * What to do when no WebMCP implementation exists (SSR, insecure context, unsupported browser):
   * - `"throw"` (default): reject with `WebMCPError("unsupported")`.
   * - `"skip"`: resolve with a registration in `state: "unsupported"`.
   */
  readonly ifUnsupported?: "throw" | "skip";
  /**
   * The model context to register into. Defaults to `document.modelContext`, looked up
   * when `register()` is called. Pass a polyfill instance or a test double here.
   */
  readonly modelContext?: ModelContextLike;
  /**
   * Origins allowed to discover and call these tools from other frames (WebMCP
   * `exposedTo`). The browser enforces it. Default: same origin only.
   */
  readonly exposedTo?: readonly string[];
  /** JSON Schema dialect requested from converters. Default `"draft-2020-12"`, the dialect the WebMCP draft references. */
  readonly jsonSchemaTarget?: JSONSchemaTarget;
  /**
   * Receives the original error for every failed call (unexpected throws, output
   * validation failures, `context()` failures). Use it for logging. What the agent
   * sees is unaffected.
   */
  readonly onError?: (error: unknown, info: { readonly toolName: string }) => void;
} & ({} extends TContext ? {} : { readonly context: () => TContext | Promise<TContext> });

/**
 * An immutable group of tools that are registered and unregistered together.
 * A toolset is a **definition**. It does nothing until `register()` is called, and you
 * can register it many times (once per mount, for example).
 */
export interface Toolset<
  TTools extends readonly AnyToolImplementation[] = readonly AnyToolImplementation[],
> {
  readonly "~webmcp": "toolset";
  readonly tools: TTools;
  /**
   * Registers every tool, **all or nothing**. All JSON Schemas are resolved first, so a
   * conversion failure registers nothing. If the browser rejects any tool (duplicate
   * name, policy), the ones already accepted are removed and the promise rejects with a
   * `WebMCPError`.
   *
   * Resolves once the browser has accepted every tool.
   *
   * Registrations issued through the SDK for the same name on the same model context are
   * queued: a new registration waits until a previous one for that name, if any, has
   * settled. This makes "unregister, then immediately register again" (React StrictMode,
   * hot reload) deterministic. It does **not** take over names registered by other code.
   */
  register(
    ...options: {} extends ToolsetContext<TTools>
      ? [options?: RegisterOptions<ToolsetContext<TTools>>]
      : [options: RegisterOptions<ToolsetContext<TTools>>]
  ): Promise<ToolsetRegistration>;
}

/**
 * Groups tools for registration. Tool names must be unique within the toolset
 * (checked at compile time for literal names).
 *
 * @example
 * export const cartTools = toolset([addToCartTool, getCartTool]);
 * const registration = await cartTools.register({ context: () => ({ cart }) });
 * // later
 * registration.unregister();
 */
export function toolset<const TTools extends readonly AnyToolImplementation[]>(
  tools: TTools & UniqueToolNames<TTools>,
): Toolset<TTools> {
  return notImplemented("toolset");
}
