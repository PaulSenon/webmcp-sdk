import type { AnyToolImplementation, InferToolContext } from "./implement.js";
import type { ModelContextLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";
import type { JSONSchemaTarget } from "./schema.js";
import type { ToolDescriptor } from "./contract.js";

// ---------------------------------------------------------------------------
// Type-level helpers
// ---------------------------------------------------------------------------

type ContextFn<T> = T extends AnyToolImplementation ? (context: InferToolContext<T>) => void : never;

/**
 * The context every tool in the list requires: the intersection of each tool's declared
 * context, keeping unions and call signatures intact.
 *
 * Fails closed: if the element type is erased (`AnyToolImplementation[]`), the
 * requirements are unknowable and the result is `never`, so `register()` cannot be
 * called without a context that can never be satisfied. Keep tool lists as tuples
 * (`toolset([a, b])`) or use `satisfies AnyToolImplementation[]`.
 */
export type ToolsetContext<TTools extends readonly AnyToolImplementation[]> =
  TTools extends readonly []
    ? {}
    : 0 extends 1 & InferToolContext<TTools[number]>
      ? never
      : [ContextFn<TTools[number]>] extends [(context: infer Ctx) => void]
        ? Ctx
        : never;

type Overlap<A extends string, B extends string> = Extract<A, B> | Extract<B, A>;

type FindDuplicate<
  TTools extends readonly AnyToolImplementation[],
  Seen extends string = never,
> = TTools extends readonly [
  infer Head extends AnyToolImplementation,
  ...infer Rest extends readonly AnyToolImplementation[],
]
  ? string extends Head["name"]
    ? FindDuplicate<Rest, Seen> // wide `string` names can only be checked at registration
    : [Overlap<Head["name"], Seen>] extends [never]
      ? FindDuplicate<Rest, Seen | Head["name"]>
      : Overlap<Head["name"], Seen>
  : never;

/**
 * `unknown` (no constraint) when tool names cannot collide. Otherwise a readable compile
 * error. Union and template-literal names are checked conservatively: any possible
 * overlap is reported. Wide `string` names are checked at registration.
 */
export type UniqueToolNames<TTools extends readonly AnyToolImplementation[]> =
  [FindDuplicate<TTools>] extends [never]
    ? unknown
    : { readonly "~error": `Potential duplicate tool name "${FindDuplicate<TTools>}" in toolset` };

// ---------------------------------------------------------------------------
// Toolset and registration
// ---------------------------------------------------------------------------

/**
 * Where a registration stands.
 * - `registered`: every tool in the toolset is live.
 * - `unsupported`: no WebMCP in this environment (and `ifUnsupported` is `"skip"`, the default). Nothing registered.
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
   * What to do when no WebMCP implementation exists (SSR, insecure context, most browsers today):
   * - `"skip"` (default): resolve with a registration in `state: "unsupported"`. Nothing
   *   is registered, and the state says so. Pages keep working where WebMCP is absent.
   * - `"throw"`: reject with `WebMCPError("unsupported")`.
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
  readonly onToolError?: (error: unknown, info: { readonly toolName: string }) => void;
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
