import type {
  AnyToolDefinition,
  InferHandlerInput,
  InferHandlerOutput,
  InferToolOutput,
} from "./define.js";
import type { ToolFailure } from "./errors.js";
import type { AnyOutputSchema } from "./schema.js";
import { isToolError } from "./errors.js";
import type { RegisterToolOptions } from "./register.js";
const handlers = new WeakMap<AnyToolImplementation, (input: any, call: ToolCallContext) => unknown>();

const delegates = new WeakMap<AnyToolImplementation, () => ReturnType<typeof implementationHandler>>();

/** Internal only: React wrappers delegate to the latest committed handler. */
export function implementationHandler(tool: AnyToolImplementation): (input: any, call: ToolCallContext) => unknown {
  const delegate = delegates.get(tool);
  if (delegate) return delegate();
  const handler = handlers.get(tool);
  if (!handler) throw new Error("Unknown tool implementation.");
  return handler;
}

/** Internal only: construct a wrapper for an already validated definition. */
export function forwardingImplementation(tool: AnyToolImplementation,
  handler: () => ReturnType<typeof implementationHandler>): AnyToolImplementation {
  const wrapper = Object.freeze({ ...tool });
  delegates.set(wrapper, handler);
  return wrapper;
}

/** What a handler receives besides its input. */
export interface ToolCallContext {
  /**
   * The call's native WebMCP execution signal. It is aborted when the caller cancels or the
   * caller's page unloads; the browser then rejects the caller and ignores any late result.
   * Cancellation is cooperative.
   *
   * It is **not** aborted when the tool is unregistered: a call that has started keeps
   * running, and its result is still delivered. It is also not aborted when this page
   * unloads (the caller gets an `AbortError`, and WebMCP does not specify more).
   */
  readonly signal: AbortSignal;
}

/**
 * The handler of a tool. It may be sync or async. It receives validated input (output
 * side of the input schema) and returns the input side of the output schema.
 */
export type ToolHandler<D extends AnyToolDefinition> = (
  input: InferHandlerInput<D>,
  call: ToolCallContext,
) => InferHandlerOutput<D> | Promise<InferHandlerOutput<D>>;

/** A definition plus its handler: one registrable tool. */
export interface ToolImplementation<D extends AnyToolDefinition = AnyToolDefinition> {
  readonly "~webmcp": "implementation";
  readonly definition: D;
  readonly name: D["name"];
}

/** Any implementation, for constraints. */
export type AnyToolImplementation = ToolImplementation<AnyToolDefinition>;

/**
 * Implements a definition. Input and output types come from the definition.
 *
 * Dependencies come from a plain factory, one per implementation:
 *
 * @example
 * export const addToCartTool = ({ cart }: { cart: Cart }) =>
 *   implementTool(addToCart, async ({ sku, quantity }) => ({ itemCount: await cart.add(sku, quantity) }));
 */
export function implementTool<D extends AnyToolDefinition>(
  definition: D & ImplementableDefinition<D>,
  // NoInfer around the whole handler type: D is inferred from the definition only, and the
  // handler is then checked against the resolved types. This keeps literal return types
  // (enums, discriminated unions) without `as const`, and still rejects wrong returns.
  handler: NoInfer<ToolHandler<D>>,
): ToolImplementation<D> {
  const tool: ToolImplementation<D> = Object.freeze({ "~webmcp": "implementation", definition, name: definition.name });
  handlers.set(tool, handler);
  return tool;
}

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/**
 * A definition must be concrete to be implemented: not a union of definitions (the handler
 * could satisfy only one of them), and not erased to `AnyToolDefinition` (types would be lost).
 */
type ImplementableDefinition<D> = true extends IsUnion<D>
  ? { readonly "~error": "Cannot implement a union of definitions. Implement each definition separately." }
  : AnyOutputSchema extends Exclude<D extends AnyToolDefinition ? D["output"] : never, undefined>
    ? { readonly "~error": "Cannot implement an erased definition (AnyToolDefinition). Pass the definition itself so its types are known." }
    : unknown;

/** The outcome of {@link runTool}. */
export type ToolRunResult<D extends AnyToolDefinition> =
  | { readonly ok: true; readonly value: InferToolOutput<D> }
  | { readonly ok: false; readonly failure: ToolFailure };

/**
 * Runs a tool exactly as a registration would (validate input → handler → validate
 * output → map failures), without a browser. Use it in unit tests.
 * `rawInput` is `unknown` on purpose: it is what an agent would send.
 *
 * @example
 * const r = await runTool(addToCartTool({ cart: fakeCart }), { sku: "TEE-1" });
 * expect(r).toEqual({ ok: true, value: { itemCount: 1 } });
 */
export function runTool<D extends AnyToolDefinition>(
  tool: ToolImplementation<D>,
  rawInput: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<ToolRunResult<D>> {
  return executePipeline(tool, rawInput, options);
}

/** Internal shared executor; registration adds diagnostics, never changes agent output. */
export async function executePipeline<D extends AnyToolDefinition>(tool: ToolImplementation<D>, rawInput: unknown,
  options?: Pick<RegisterToolOptions, "signal" | "onUnexpectedError">): Promise<ToolRunResult<D>> {
  let handler: ReturnType<typeof implementationHandler>;
  let handlerCalled = false;
  const report = (error: unknown, kind: "internal" | "output_invalid" | "tool_error") => {
    try { options?.onUnexpectedError?.(error, { toolName: tool.name, kind, handlerCalled }); }
    catch (hookError) { console.error("webmcp-sdk onUnexpectedError threw", hookError); }
  };
  const fail = (kind: "internal" | "output_invalid", error: unknown): ToolRunResult<D> => {
    report(error, kind);
    const message = kind === "output_invalid"
      ? "The tool ran, but its result failed validation. The action may have been performed; check the current state before retrying."
      : handlerCalled ? "The tool failed unexpectedly. It may have partially run; check the current state before retrying."
      : "The tool failed unexpectedly before running. The tool did not run.";
    return { ok: false, failure: kind === "output_invalid" ? { kind, handlerCalled: true, message } : { kind, handlerCalled, message } };
  };
  let input = rawInput === undefined ? {} : rawInput;
  try {
    handler = implementationHandler(tool);
    if (tool.definition.input) {
      const result = await tool.definition.input["~standard"].validate(input);
      if (result.issues) {
        const issues = result.issues.slice(0, 20).map(issue => ({ message: issue.message,
          path: issue.path?.map((segment, i) => {
            const key = typeof segment === "object" ? segment.key : segment;
            return typeof key === "number" ? `[${key}]` : `${i ? "." : ""}${String(key)}`;
          }).join("") || "(root)" }));
        return { ok: false, failure: { kind: "input_invalid", handlerCalled: false,
          message: "Arguments rejected; the tool did not run. Fix the fields below and call again.", issues,
          ...(result.issues.length > 20 ? { omittedIssues: result.issues.length - 20 } : {}) } };
      }
      input = result.value;
    }
  } catch (error) { return fail("internal", error); }
  let output: unknown;
  try {
    handlerCalled = true;
    output = await handler(input, { signal: options?.signal ?? new AbortController().signal });
  } catch (error) {
    if (!isToolError(error)) return fail("internal", error);
    let data = error.data;
    if (data !== undefined) {
      try { assertSerializable(data); } catch (cause) { data = undefined; report(cause, "tool_error"); }
    }
    return { ok: false, failure: { kind: "tool_error", handlerCalled: true, message: error.message,
      ...(error.code !== undefined ? { code: error.code } : {}), ...(data !== undefined ? { data } : {}) } };
  }
  try {
    if (tool.definition.output) {
      const result = await tool.definition.output["~standard"].validate(output);
      if (result.issues) return fail("output_invalid", result.issues);
      output = result.value;
    } else if (output === undefined) output = null;
    assertSerializable(output);
    return { ok: true, value: output as InferToolOutput<D> };
  } catch (error) { return fail("output_invalid", error); }
}
function assertSerializable(value: unknown) {
  if (JSON.stringify(value) === undefined) throw new TypeError("Result cannot be serialized as JSON.");
}
