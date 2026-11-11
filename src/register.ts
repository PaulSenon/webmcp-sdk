import type { ToolFailureKind, WebMCPErrorCode } from "./errors.js";
import type { AnyToolImplementation } from "./implement.js";
import type { ModelContextLike } from "./model-context.js";
import { WebMCPError } from "./errors.js";
import { toJSONSchema } from "./define.js";
import { executePipeline } from "./implement.js";
import type { ModelContextTool } from "./model-context.js";
import { defaultPublisher } from "./context.js";
import { withAbort } from "./abort.js";
import { errorName } from "./internal.js";

import { coordinateRegistration } from "./registration-coordination.js";
export { registrationConflictEnded } from "./registration-coordination.js";
import { envelopeSchema } from "./errors.js";

// ---------------------------------------------------------------------------
// Compile-time duplicate-name check for `registerTools` (best-effort)
// ---------------------------------------------------------------------------

type Overlap<A extends string, B extends string> = Extract<A, B> | Extract<B, A>;
type Check<H extends AnyToolImplementation, Seen extends string> = string extends H["name"]
  ? never
  : Overlap<H["name"], Seen>;
type NameOf<H extends AnyToolImplementation> = string extends H["name"] ? never : H["name"];
/**
 * Scans known tuple elements from the front, then from the back (so `[...dynamic, a, a]` is
 * still checked). Bounded: very long tuples (> 200) and dynamic arrays are only checked at runtime.
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
 * `unknown` when names cannot collide; otherwise a readable compile error. Best-effort: names
 * in dynamic arrays (`.map()`, erased element types) are checked at runtime, where a
 * duplicate is reported as that tool's `duplicate_name` error.
 */
export type UniqueToolNames<T extends readonly AnyToolImplementation[]> = [FindDuplicate<T>] extends [never]
  ? unknown
  : { readonly "~error": `Duplicate tool name "${FindDuplicate<T>}"` };

// ---------------------------------------------------------------------------
// Registration (mirrors WebMCP's `registerTool(tool, { signal })`)
// ---------------------------------------------------------------------------

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

export interface RegisterToolOptions {
  /**
   * The tool's lifetime, as in WebMCP. Aborting it unregisters the tool, or every tool of a
   * `registerTools` call. Calls already running are not cancelled (WebMCP semantics).
   */
  readonly signal?: AbortSignal;
  /**
   * The model context to register into, used as-is when given. Default:
   * `document.modelContext`, looked up at call time. During SSR, or without WebMCP, the
   * result is `"unsupported"`.
   */
  readonly modelContext?: ModelContextLike;
  /** Origins allowed to discover and call these tools from other frames (native `exposedTo`, enforced by the browser). */
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

/** The outcome of registering one tool. */
export type RegisterToolStatus =
  | "registered"
  /** No WebMCP in this environment: nothing registered, nothing thrown. */
  | "unsupported";

/**
 * Registers one tool, like WebMCP's `registerTool`, plus definitions, validation, types and
 * agent-readable failures.
 *
 * - Resolves `"registered"`, or `"unsupported"` when WebMCP is not available.
 * - Rejects with a `WebMCPError` on real failures (`duplicate_name`, `json_schema_unavailable`,
 *   `registration_failed`), like the native call.
 * - Rejects with `signal.reason` if the signal is already aborted or aborts while registering.
 *
 * @example
 * const controller = new AbortController();
 * await registerTool(searchTool, { signal: controller.signal });
 * // later
 * controller.abort();
 */
export function registerTool(tool: AnyToolImplementation, options?: RegisterToolOptions): Promise<RegisterToolStatus> {
  return registerOne(tool, options ?? {});
}

/** A `WebMCPError` as produced by registration (never `invalid_definition`, which `defineTool` throws). */
export type RegistrationError = WebMCPError & { readonly code: Exclude<WebMCPErrorCode, "invalid_definition"> };

/** The outcome for one tool of a {@link registerTools} call. */
export type RegisterToolsResult =
  | { readonly name: string; readonly status: RegisterToolStatus; readonly error?: undefined }
  | { readonly name: string; readonly status: "error"; readonly error: RegistrationError };

/**
 * Registers several tools in one call, sharing one lifetime (`signal`).
 *
 * Resolves once every tool has settled, with one result per tool, in order. It does not
 * reject because one tool failed: the tools that succeeded stay registered under the
 * signal, and failed ones need no cleanup. There is no rollback. If you want "all or
 * nothing", check the results and abort the signal yourself.
 *
 * Rejects only with `signal.reason` if the signal is already aborted or aborts while
 * registering.
 *
 * @example
 * const shop = new AbortController();
 * const results = await registerTools([searchTool, addToCartTool({ cart })], { signal: shop.signal });
 * shop.abort(); // removes every tool registered by this call
 */
export function registerTools<const T extends readonly AnyToolImplementation[]>(
  tools: T & UniqueToolNames<T>,
  options?: RegisterToolOptions,
): Promise<readonly RegisterToolsResult[]> {
  const seen = new Set<string>();
  const results = Promise.all(tools.map(async (tool): Promise<RegisterToolsResult> => {
    try {
      if (seen.has(tool.name)) throw new WebMCPError("duplicate_name", "Duplicate tool name in list.", { toolName: tool.name });
      seen.add(tool.name);
      return { name: tool.name, status: await registerTool(tool, options) };
    } catch (error) {
      if (options?.signal?.aborted) throw options.signal.reason;
      return { name: tool.name, status: "error", error: error as RegistrationError };
    }
  }));
  return withAbort(results, options?.signal);
}

async function registerOne(tool: AnyToolImplementation, options: RegisterToolOptions): Promise<RegisterToolStatus> {
  options.signal?.throwIfAborted();
  const context = options.modelContext ?? defaultPublisher();
  if (!context) return "unsupported";
  return coordinateRegistration(context, tool.name, options.signal, async () => {
    options.signal?.throwIfAborted();
    const native = buildNativeTool(tool, options);
    try {
      await context.registerTool(native, {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}),
      });
      return "registered" as const;
    } catch (cause) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw mapNativeError(cause, tool.name);
    }
  });
}

function requireSchema(resolution: ReturnType<typeof toJSONSchema>["input"], toolName: string) {
  if (!resolution.ok) throw new WebMCPError("json_schema_unavailable", resolution.message, { toolName, cause: resolution.cause });
  return resolution.schema;
}
function buildNativeTool(tool: AnyToolImplementation, options: RegisterToolOptions): ModelContextTool {
  const schemas = toJSONSchema(tool.definition);
  for (const resolution of [schemas.input, schemas.output]) {
    if (resolution && !resolution.ok) throw new WebMCPError("json_schema_unavailable", resolution.message,
      { toolName: tool.name, cause: resolution.cause });
  }
  const input = requireSchema(schemas.input, tool.name);
  const definition = tool.definition;
  const native: ModelContextTool = {
    name: tool.name, description: definition.description, inputSchema: input,
    ...(definition.title !== undefined ? { title: definition.title } : {}),
    ...(definition.annotations ? { annotations: definition.annotations } : {}),
    ...(schemas.output?.ok ? { outputSchema: { anyOf: [schemas.output.schema, envelopeSchema] } } : {}),
    execute: async (input, { signal }) => {
      const result = await executePipeline(tool, input, { signal,
        ...(options.onUnexpectedError ? { onUnexpectedError: options.onUnexpectedError } : {}) });
      return result.ok ? result.value : { isError: true, error: result.failure };
    },
  };
  return native;
}
function mapNativeError(cause: unknown, toolName: string): RegistrationError {
  return new WebMCPError(errorName(cause) === "InvalidStateError" ? "duplicate_name" : "registration_failed",
    "Native tool registration failed.", { toolName, cause }) as RegistrationError;
}
