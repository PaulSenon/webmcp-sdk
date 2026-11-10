import type {
  AnyToolDefinition,
  InferHandlerInput,
  InferHandlerOutput,
  InferToolOutput,
} from "./define.js";
import type { ToolFailure } from "./errors.js";
import type { AnyOutputSchema } from "./schema.js";
import { notImplemented } from "./not-implemented.js";

/** What a handler receives besides its input. */
export interface ToolCallContext {
  /**
   * The call's native execution signal: aborted when the caller cancels or the caller's
   * page unloads. Cancellation is cooperative. **Unregistering the tool does not abort
   * it**, because a call that has started runs to completion.
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
  return notImplemented("implementTool");
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
  return notImplemented("runTool");
}
