import { notImplemented } from "./not-implemented.js";
import type {
  AnyInputSchema,
  AnyOutputSchema,
  InferSchemaInput,
  InferSchemaOutput,
  JSONSchema,
  JSONSchemaResolution,
  JSONSchemaTarget,
  JsonValue,
  ToolArguments,
} from "./schema.js";

/**
 * Behaviour hints for agents, as defined by the WebMCP draft. They are **hints**, not
 * guarantees. WebMCP's set differs from MCP's (`destructiveHint` and friends do not exist here).
 */
export interface ToolAnnotations {
  /** The tool does not change state. */
  readonly readOnlyHint?: boolean;
  /** The result may contain content the page does not control (user posts, emails...). */
  readonly untrustedContentHint?: boolean;
  /** The tool has meaningful consequences (purchase, send, delete). Agents may ask the user first. */
  readonly consequentialHint?: boolean;
  /** Tool exists for debugging; agents may hide it (Chrome documents this from v156). */
  readonly debugging?: boolean;
}

/** What you write to define a contract. */
export interface ContractDefinition<
  TName extends string = string,
  TInput extends AnyInputSchema | undefined = AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined = AnyOutputSchema | undefined,
> {
  /**
   * Unique name within a document, e.g. `"add_to_cart"`.
   * WebMCP requires 1-128 ASCII letters, digits, `_`, `-` or `.` (case-sensitive) and rejects
   * anything else at registration.
   */
  readonly name: TName;
  /** Short human-readable label, e.g. `"Add to cart"`. */
  readonly title?: string;
  /** What the tool does and when to use it. Agents read this to choose tools; be specific. */
  readonly description: string;
  /** Arguments schema. Omit for tools that take no arguments. */
  readonly input?: TInput;
  /** Result schema. Omit to return any `JsonValue`, unvalidated. */
  readonly output?: TOutput;
  readonly annotations?: ToolAnnotations;
}

/**
 * A reusable, implementation-free description of a tool: name, metadata and schemas.
 *
 * A contract has no handler and no browser dependency. You can share it between the
 * page that implements the tool and code that calls it (tests, an in-page agent, a
 * typed consumer binding).
 */
export interface ToolContract<
  TName extends string = string,
  TInput extends AnyInputSchema | undefined = AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined = AnyOutputSchema | undefined,
> {
  readonly "~webmcp": "contract";
  readonly name: TName;
  readonly title: string | undefined;
  readonly description: string;
  readonly input: TInput;
  readonly output: TOutput;
  readonly annotations: ToolAnnotations | undefined;

  /**
   * Resolves the JSON Schemas agents will see. This is the same conversion that
   * registration runs. Call it in a unit test to catch non-convertible schemas
   * before shipping.
   */
  toJSONSchema(options?: { readonly target?: JSONSchemaTarget }): {
    readonly input: JSONSchemaResolution;
    readonly output: JSONSchemaResolution | undefined;
  };
}

/** Any contract, for constraints. */
export type AnyContract = ToolContract<string, AnyInputSchema | undefined, AnyOutputSchema | undefined>;

/** Empty arguments object for tools without an `input` schema. */
export type NoArguments = Record<string, never>;

// ---------------------------------------------------------------------------
// Type helpers. "Tool" means the agent's side of the boundary; "Handler" means yours.
// All are distributive, so `input?: Schema | undefined` stays correct.
// ---------------------------------------------------------------------------

type ToolInputOf<S> = S extends AnyInputSchema ? InferSchemaInput<S> : NoArguments;
type HandlerInputOf<S> = S extends AnyInputSchema ? InferSchemaOutput<S> : NoArguments;
type HandlerOutputOf<S> = S extends AnyOutputSchema ? InferSchemaInput<S> : JsonValue | void;
type ToolOutputOf<S> = S extends AnyOutputSchema ? InferSchemaOutput<S> : unknown;

/** Arguments as the **agent** sends them (schema input side, before transforms). */
export type InferToolInput<C extends AnyContract> = ToolInputOf<C["input"]>;

/** Arguments as your **handler** receives them (schema output side, after validation and transforms). */
export type InferHandlerInput<C extends AnyContract> = HandlerInputOf<C["input"]>;

/**
 * What your **handler** must return: the output schema's *input* side, before transforms.
 * Without an output schema, any {@link JsonValue}. Returning nothing (`void`) is sent as `null`.
 */
export type InferHandlerOutput<C extends AnyContract> = HandlerOutputOf<C["output"]>;

/**
 * What the **agent** receives (output schema *output* side, after validation and transforms).
 * `unknown` without an output schema.
 */
export type InferToolOutput<C extends AnyContract> = ToolOutputOf<C["output"]>;

/** The resolved tool descriptor handed to the browser. Developer-visible for debugging and tests. */
export interface ToolDescriptor {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
  readonly outputSchema?: JSONSchema;
  readonly annotations?: ToolAnnotations;
}

/** Rejects `""` and unions that may be `""`. Wide `string` names are checked at registration. */
type ValidName<TName extends string> = string extends TName ? TName : "" extends TName ? never : TName;

type InputGuard<S> =
  0 extends 1 & InferSchemaInput<S>
    ? InvalidInput<"`any` input type">
    : [InferSchemaInput<S>] extends [never]
      ? InvalidInput<"`never` input type">
      : [InferSchemaInput<S>] extends [object]
        ? [Extract<InferSchemaInput<S>, readonly unknown[] | Function | Date>] extends [never]
          ? unknown
          : InvalidInput<"array, function or Date input type">
        : InvalidInput<"non-object input type">;
type InvalidInput<Why extends string> = {
  readonly "~error": `Tool input must be an object schema (got ${Why}). WebMCP requires inputSchema of type "object".`;
};
type OptionalInputGuard<S> = [Exclude<S, undefined>] extends [never]
  ? unknown
  : InputGuard<Exclude<S, undefined>>;

/**
 * The parameter type of `contract()` and `tool()`. Infers literal names, then checks them
 * (non-empty) and checks that the input schema describes an object.
 */
export type ContractDefinitionArg<
  TName extends string,
  TInput extends AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined,
> = ContractDefinition<TName, TInput, TOutput> & {
  readonly name: ValidName<NoInfer<TName>>;
  readonly input?: TInput & OptionalInputGuard<TInput>;
};

/**
 * Defines a tool contract: metadata and schemas, no implementation.
 *
 * @example
 * export const addToCart = contract({
 *   name: "add_to_cart",
 *   title: "Add to cart",
 *   description: "Add a product to the shopping cart by SKU.",
 *   input: z.object({ sku: z.string(), quantity: z.number().int().min(1).default(1) }),
 *   output: z.object({ cartSize: z.number() }),
 * });
 */
export function contract<
  const TName extends string,
  TInput extends AnyInputSchema | undefined = undefined,
  TOutput extends AnyOutputSchema | undefined = undefined,
>(definition: ContractDefinitionArg<TName, TInput, TOutput>): ToolContract<TName, TInput, TOutput> {
  return notImplemented("contract");
}

/** Re-exported for advanced typing. */
export type { ToolArguments };
