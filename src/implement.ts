import type {
  AnyContract,
  ContractDefinition,
  InferHandlerInput,
  InferHandlerOutput,
  ToolContract,
} from "./contract.js";
import { notImplemented } from "./not-implemented.js";
import type { AnyInputSchema, AnyOutputSchema } from "./schema.js";

/** Everything a handler receives for one call. */
export interface ToolCall<C extends AnyContract, TContext> {
  /** Validated, transformed arguments. */
  readonly input: InferHandlerInput<C>;
  /** The context supplied by whoever registered the toolset (`register({ context })`). */
  readonly context: TContext;
  /**
   * Aborted when the agent cancels the call (the browser's execute signal) **or** when
   * this toolset is unregistered. The browser does not cancel running calls on
   * unregister, so the SDK adds that. Pass the signal to `fetch` and other async work.
   * Cancellation is cooperative: if your handler completes anyway, its result is returned.
   */
  readonly signal: AbortSignal;
}

/** A handler may be sync or async. Validation of its result runs either way. */
export type ToolHandler<C extends AnyContract, TContext> = (
  call: ToolCall<C, TContext>,
) => InferHandlerOutput<C> | Promise<InferHandlerOutput<C>>;

/**
 * A contract plus its handler: one ready-to-register tool.
 * `TContext` is what the handler needs from the registration site.
 */
export interface ToolImplementation<C extends AnyContract = AnyContract, TContext = any> {
  readonly "~webmcp": "implementation";
  readonly contract: C;
  readonly name: C["name"];
  /** @internal Type carrier only; no runtime value. */
  readonly "~context"?: (context: TContext) => void;
}

/** Any implementation, for constraints. */
export type AnyToolImplementation = ToolImplementation<AnyContract, any>;

/** The context type an implementation requires. */
export type InferToolContext<T> = T extends ToolImplementation<any, infer Ctx> ? Ctx : never;

/**
 * Builds the implementation of one contract. The builder steps are type-only except
 * `.handler()`.
 */
export interface Implementer<C extends AnyContract, TContext = {}> {
  /**
   * Declares what the handler needs from the registration site. Type-only, no runtime
   * effect. Optional: skip it if your handler closes over what it needs.
   *
   * @example
   * implement(addToCart)
   *   .$context<{ cart: CartStore }>()
   *   .handler(({ input, context }) => context.cart.add(input.sku, input.quantity));
   */
  $context<TNewContext extends object>(): Implementer<C, TNewContext>;

  /** Attaches the handler and returns a registrable tool. */
  handler(handler: ToolHandler<C, TContext>): ToolImplementation<C, TContext>;
}

/**
 * Starts implementing an existing contract.
 *
 * @example
 * export const addToCartTool = implement(addToCart).handler(async ({ input }) => {
 *   const cart = await api.add(input.sku, input.quantity);
 *   return { cartSize: cart.items.length };
 * });
 */
export function implement<C extends AnyContract>(contract: C): Implementer<C> {
  return notImplemented("implement");
}

/**
 * Shorthand for `implement(contract(definition))`: define and implement in one place.
 * Use it when nothing else needs the contract on its own.
 *
 * @example
 * const getTime = tool({
 *   name: "get_time",
 *   description: "Current time in ISO 8601.",
 * }).handler(() => new Date().toISOString());
 */
export function tool<
  const TName extends string,
  TInput extends AnyInputSchema | undefined = undefined,
  TOutput extends AnyOutputSchema | undefined = undefined,
>(
  definition: ContractDefinition<TName, TInput, TOutput>,
): Implementer<ToolContract<TName, TInput, TOutput>> {
  return notImplemented("tool");
}
