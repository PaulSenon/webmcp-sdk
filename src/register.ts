import type { WebMCPError, ToolFailureKind } from "./errors.js";
import type { AnyToolDefinition } from "./define.js";
import type { AnyToolImplementation } from "./implement.js";
import type { ModelContextLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";

// ---------------------------------------------------------------------------
// Compile-time duplicate-name check (literal names; wide `string` names are checked at runtime)
// ---------------------------------------------------------------------------

type Overlap<A extends string, B extends string> = Extract<A, B> | Extract<B, A>;
type FindDuplicate<T extends readonly AnyToolImplementation[], Seen extends string = never> = T extends readonly [
  infer Head extends AnyToolImplementation,
  ...infer Rest extends readonly AnyToolImplementation[],
]
  ? string extends Head["name"]
    ? FindDuplicate<Rest, Seen>
    : [Overlap<Head["name"], Seen>] extends [never]
      ? FindDuplicate<Rest, Seen | Head["name"]>
      : Overlap<Head["name"], Seen>
  : never;

/** `unknown` when names cannot collide; otherwise a readable compile error. */
export type UniqueToolNames<T extends readonly AnyToolImplementation[]> = [FindDuplicate<T>] extends [never]
  ? unknown
  : { readonly "~error": `Duplicate tool name "${FindDuplicate<T>}"` };

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Where one tool stands in a registration. */
export type ToolRegistrationState =
  /** Being registered (or queued behind a previous registration of the same name). */
  | "pending"
  | "registered"
  /** No WebMCP in this environment: nothing registered, nothing thrown. */
  | "unsupported"
  /** The browser rejected it, or its schemas could not be converted; see `error`. */
  | "error";

export interface ToolRegistrationEntry {
  readonly name: string;
  readonly definition: AnyToolDefinition;
  readonly state: ToolRegistrationState;
  /** Set when `state` is `"error"`: `duplicate_name`, `json_schema_unavailable` or `registration_failed`. */
  readonly error?: WebMCPError;
}

/** Immutable view of a registration. A new object on every change, the same object otherwise. */
export interface ToolRegistrationSnapshot {
  /** `false` without WebMCP (every tool is then `"unsupported"`). `undefined` before anything was attempted (React SSR / first render). */
  readonly supported: boolean | undefined;
  readonly tools: readonly ToolRegistrationEntry[];
}

/** Details passed to `onToolError`. */
export interface ToolErrorInfo {
  readonly toolName: string;
  /** What the agent was told. */
  readonly kind: ToolFailureKind;
  readonly handlerCalled: boolean;
}

export interface RegisterToolsOptions {
  /** Aborting it is the same as `unregister()`. */
  readonly signal?: AbortSignal;
  /** Defaults to `document.modelContext`. Pass a polyfill or a test double here. */
  readonly modelContext?: ModelContextLike;
  /** Origins allowed to discover and call these tools from other frames (native `exposedTo`, enforced by the browser). */
  readonly exposedTo?: readonly string[];
  /**
   * Receives the original error behind every failed call (defects, output issues,
   * unserializable `ToolError` data, crashing validators). For logging only. What the agent
   * sees is unaffected. Errors thrown by this callback are caught and logged.
   */
  readonly onToolError?: (error: unknown, info: ToolErrorInfo) => void;
}

/**
 * A live registration in one document. The handle is synchronous; registration work is async.
 */
export interface ToolRegistration {
  /**
   * Declares the new desired list. Tools are matched **by definition identity** (not by
   * array identity):
   * - **kept** definitions get the new handler (no re-registration);
   * - **removed** ones are unregistered first, then **added** ones are registered;
   * - a same-name replacement waits for the old registration to be gone.
   *
   * Calls already running are not affected. The list is copied, so later mutations of the
   * array are ignored until the next `update`.
   */
  update<const T extends readonly AnyToolImplementation[]>(tools: T & UniqueToolNames<T>): void;
  /** Unregisters every tool. Idempotent. Running calls finish normally. */
  unregister(): void;
  getSnapshot(): ToolRegistrationSnapshot;
  /** Called after each snapshot change. Not called on subscribe. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: ToolRegistrationSnapshot) => void): () => void;
  /** Resolves once the current desired list is reconciled. Never rejects: errors are in the snapshot. */
  settled(): Promise<ToolRegistrationSnapshot>;
}

/**
 * Registers tools in the current document and returns a handle to update or remove them.
 *
 * Never throws for environment or browser problems. Without WebMCP, every tool is
 * `"unsupported"`, and the other failures are per-tool `"error"` states.
 *
 * @example
 * const reg = registerTools([searchTool, addToCartTool({ cart })]);
 * reg.update([searchTool, addToCartTool({ cart }), checkoutTool({ cart })]);
 * reg.unregister();
 */
export function registerTools<const T extends readonly AnyToolImplementation[]>(
  tools: T & UniqueToolNames<T>,
  options?: RegisterToolsOptions,
): ToolRegistration {
  return notImplemented("registerTools");
}
