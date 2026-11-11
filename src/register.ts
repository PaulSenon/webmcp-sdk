import type { ToolFailureKind, WebMCPError } from "./errors.js";
import type { AnyToolDefinition } from "./define.js";
import type { AnyToolImplementation } from "./implement.js";
import type { ModelContextLike } from "./model-context.js";
import { notImplemented } from "./not-implemented.js";

// ---------------------------------------------------------------------------
// Compile-time duplicate-name check (literal names; wide `string` names are checked at runtime)
// ---------------------------------------------------------------------------

type Overlap<A extends string, B extends string> = Extract<A, B> | Extract<B, A>;
type Check<H extends AnyToolImplementation, Seen extends string> = string extends H["name"]
  ? never
  : Overlap<H["name"], Seen>;
type NameOf<H extends AnyToolImplementation> = string extends H["name"] ? never : H["name"];
/**
 * Scans known tuple elements from the front, then from the back (so `[...dynamic, a, a]` is
 * still checked). The scan is bounded: very long tuples (more than 200 elements) and
 * non-tuple arrays are checked at runtime only.
 */
type FindDuplicate<
  T extends readonly AnyToolImplementation[],
  Seen extends string = never,
  Depth extends unknown[] = [],
> = Depth["length"] extends 200
  ? never
  : T extends readonly [infer H extends AnyToolImplementation, ...infer R extends readonly AnyToolImplementation[]]
    ? [Check<H, Seen>] extends [never]
      ? FindDuplicate<R, Seen | NameOf<H>, [...Depth, unknown]>
      : Check<H, Seen>
    : T extends readonly [...infer R extends readonly AnyToolImplementation[], infer L extends AnyToolImplementation]
      ? [Check<L, Seen>] extends [never]
        ? FindDuplicate<R, Seen | NameOf<L>, [...Depth, unknown]>
        : Check<L, Seen>
      : never;

/**
 * `unknown` when names cannot collide; otherwise a readable compile error. This is
 * best-effort: names hidden in dynamic arrays (`.map()`, erased element types) are only
 * checked at runtime, where a duplicate becomes a per-tool `duplicate_name` state.
 */
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

export type ToolRegistrationEntry =
  | {
      readonly name: string;
      readonly definition: AnyToolDefinition;
      readonly state: Exclude<ToolRegistrationState, "error">;
      readonly error?: undefined;
    }
  | {
      readonly name: string;
      readonly definition: AnyToolDefinition;
      readonly state: "error";
      /** `duplicate_name`, `json_schema_unavailable` (including a non-object input root) or `registration_failed`. */
      readonly error: WebMCPError;
    };

/** Immutable view of a registration. A new object on every change, the same object otherwise. */
export interface ToolRegistrationSnapshot {
  /** `false` without WebMCP (every tool is then `"unsupported"`). `undefined` before anything was attempted (React SSR / first render). */
  readonly supported: boolean | undefined;
  readonly tools: readonly ToolRegistrationEntry[];
}

/** Details passed to `onUnexpectedError`. */
export interface UnexpectedErrorInfo {
  readonly toolName: string;
  /**
   * What the agent was told: `internal`, `output_invalid`, or `tool_error` when a
   * `ToolError`'s `data` could not be serialized and was dropped.
   */
  readonly kind: Extract<ToolFailureKind, "internal" | "output_invalid" | "tool_error">;
  readonly handlerCalled: boolean;
}

export interface RegisterToolsOptions {
  /** Aborting it is the same as `unregister()`. */
  readonly signal?: AbortSignal;
  /**
   * The model context to register into. Used as-is and exclusively when given (never falls
   * back to `document`). Any object matching the structure works: a test double, or another
   * implementation.
   *
   * Default: `document.modelContext`, looked up when the registration is created and again
   * on each `update()` while it is still missing. That way a polyfill installed later is
   * picked up at the next update, with no polling. During SSR it is `"unsupported"`.
   */
  readonly modelContext?: ModelContextLike;
  /**
   * Origins allowed to discover and call these tools from other frames (native `exposedTo`,
   * enforced by the browser). Fixed for the registration's lifetime.
   */
  readonly exposedTo?: readonly string[];
  /**
   * Receives the original error behind failures you did **not** throw on purpose: defects
   * (`internal`, including crashing validators), output validation failures
   * (`output_invalid`), and unserializable `ToolError` data. It is never called for
   * `input_invalid` or for a valid `ToolError`. For logging only: what the agent sees is
   * unaffected. Errors thrown by this callback are caught and logged.
   */
  readonly onUnexpectedError?: (error: unknown, info: UnexpectedErrorInfo) => void;
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
  /**
   * Unregisters every tool. Idempotent. Running calls finish normally. Afterwards the
   * handle is finished: `update` is ignored and `settled()` resolves immediately.
   */
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
