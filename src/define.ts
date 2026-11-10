import { notImplemented } from "./not-implemented.js";
import type {
  AnyInputSchema,
  AnyOutputSchema,
  InferSchemaInput,
  InferSchemaOutput,
  JSONSchemaResolution,
  JsonValue,
} from "./schema.js";

/**
 * Behaviour hints for agents, using the WebMCP draft's names. They are **hints**, not
 * guarantees. WebMCP's set differs from MCP's (`destructiveHint` and friends do not exist).
 */
export interface ToolAnnotations {
  /** The tool does not change state. */
  readonly readOnlyHint?: boolean;
  /** The result may contain content the page does not control (user posts, emails…). */
  readonly untrustedContentHint?: boolean;
  /** The tool has meaningful consequences (purchase, send, delete). Agents may ask the user first. */
  readonly consequentialHint?: boolean;
  /** The tool exists for debugging; agents may hide it. */
  readonly debugging?: boolean;
}

/** What you pass to {@link defineTool}. */
export type ToolDefinitionInit<
  TName extends string = string,
  TInput extends AnyInputSchema | undefined = AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined = AnyOutputSchema | undefined,
> = ToolMetadataInit<TName> &
  // A schema type that excludes `undefined` makes its property required: the definition
  // can never claim a schema that was not supplied.
  (undefined extends TInput ? { readonly input?: TInput } : { readonly input: TInput }) &
  (undefined extends TOutput ? { readonly output?: TOutput } : { readonly output: TOutput });

/** The metadata part of {@link ToolDefinitionInit}; schemas are documented there. */
export interface ToolMetadataInit<TName extends string = string> {
  /**
   * Unique within a document, e.g. `"add_to_cart"`. WebMCP allows 1–128 ASCII letters,
   * digits, `_`, `-`, `.` (case-sensitive).
   *
   * A name is a contract: if the tool's meaning changes, give it a new name.
   */
  readonly name: TName;
  /** Short human-readable label, e.g. `"Add to cart"`. */
  readonly title?: string;
  /** What the tool does and when to use it. Agents read this to pick tools, so be specific. */
  readonly description: string;
  /*
   * input?: arguments schema (an object schema). Omit it for tools without arguments.
   * output?: result schema. When present, every result is validated against it.
   */
  readonly annotations?: ToolAnnotations;
}

/**
 * A tool definition: name, metadata and schemas, with **no** implementation and no
 * browser dependency. This is the agent-facing contract. Share it between the page that
 * implements the tool, tests, and code that calls the tool.
 */
export interface ToolDefinition<
  TName extends string = string,
  TInput extends AnyInputSchema | undefined = AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined = AnyOutputSchema | undefined,
> {
  readonly "~webmcp": "definition";
  readonly name: TName;
  readonly title: string | undefined;
  readonly description: string;
  readonly input: TInput;
  readonly output: TOutput;
  readonly annotations: ToolAnnotations | undefined;
}

/** Any definition, for constraints. */
export type AnyToolDefinition = ToolDefinition<string, AnyInputSchema | undefined, AnyOutputSchema | undefined>;

declare const noArguments: unique symbol;
/**
 * Arguments of a tool without an `input` schema: an empty object. It is shaped so that it
 * never makes a property look present (unlike `Record<string, never>`).
 */
export type NoArguments = { readonly [noArguments]?: never };

// ---------------------------------------------------------------------------
// Inference. "Tool" = the agent's side of the boundary; "Handler" = yours.
// All helpers distribute, so `input?: Schema | undefined` stays correct.
// ---------------------------------------------------------------------------

type ToolInputOf<S> = S extends AnyInputSchema ? InferSchemaInput<S> : NoArguments;
type HandlerInputOf<S> = S extends AnyInputSchema ? InferSchemaOutput<S> : NoArguments;
type HandlerOutputOf<S> = S extends AnyOutputSchema ? InferSchemaInput<S> : JsonValue | void;
type ToolOutputOf<S> = S extends AnyOutputSchema ? InferSchemaOutput<S> : unknown;

/** Arguments as the **agent** sends them (input schema, input side: before transforms and defaults). */
export type InferToolInput<D extends AnyToolDefinition> = ToolInputOf<D["input"]>;
/** Arguments as your **handler** receives them (input schema, output side: validated, transformed). */
export type InferHandlerInput<D extends AnyToolDefinition> = HandlerInputOf<D["input"]>;
/**
 * What your **handler** returns: the output schema's input side. Without an output schema,
 * any `JsonValue`, or nothing (sent as `null`).
 */
export type InferHandlerOutput<D extends AnyToolDefinition> = HandlerOutputOf<D["output"]>;
/** What the **agent** receives on success: the output schema's output side, or `unknown` without one. */
export type InferToolOutput<D extends AnyToolDefinition> = ToolOutputOf<D["output"]>;

// ---------------------------------------------------------------------------
// Compile-time checks on the definition
// ---------------------------------------------------------------------------

/** Rejects `""` and unions that may be `""`. Wide `string` names are checked at runtime. */
type ValidName<TName extends string> = string extends TName ? TName : "" extends TName ? never : TName;

type InvalidInput<Why extends string> = {
  readonly "~error": `Tool input must be an object schema (got ${Why}). WebMCP requires inputSchema of type "object".`;
};
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
type OptionalInputGuard<S> = [Exclude<S, undefined>] extends [never] ? unknown : InputGuard<Exclude<S, undefined>>;

/** `S | undefined` (a schema that may or may not be there) is rejected: pass the schema, or omit the property. */
type Definite<S, Prop extends string> = [S] extends [undefined]
  ? unknown
  : undefined extends S
    ? { readonly "~error": `\`${Prop}\` may be undefined. Pass a schema or omit \`${Prop}\`; define two tools if it is conditional.` }
    : unknown;

/** The parameter type of {@link defineTool}: infers a literal name, then checks it and the input schema. */
export type ToolDefinitionArg<
  TName extends string,
  TInput extends AnyInputSchema | undefined,
  TOutput extends AnyOutputSchema | undefined,
> = ToolDefinitionInit<TName, TInput, TOutput> & {
  readonly name: ValidName<NoInfer<TName>>;
  readonly input?: TInput & OptionalInputGuard<TInput> & Definite<TInput, "input">;
  readonly output?: TOutput & Definite<TOutput, "output">;
};

/**
 * Defines a tool: metadata and schemas, no implementation.
 *
 * Schemas must support both Standard Schema validation and Standard JSON Schema
 * conversion (checked at compile time). Conversion itself runs lazily, at registration.
 *
 * Throws `WebMCPError("invalid_definition")` for an invalid name or an empty description.
 *
 * @example
 * export const addToCart = defineTool({
 *   name: "add_to_cart",
 *   title: "Add to cart",
 *   description: "Add a product to the cart by SKU. Returns the new item count.",
 *   input: z.object({ sku: z.string(), quantity: z.number().int().min(1).default(1) }),
 *   output: z.object({ itemCount: z.number() }),
 * });
 */
export function defineTool<
  const TName extends string,
  TInput extends AnyInputSchema | undefined = undefined,
  TOutput extends AnyOutputSchema | undefined = undefined,
>(definition: ToolDefinitionArg<TName, TInput, TOutput>): ToolDefinition<TName, TInput, TOutput> {
  return notImplemented("defineTool");
}

/**
 * Runs the JSON Schema conversion that registration would run, eagerly. Use it in a unit
 * test so that non-convertible schemas (e.g. Zod `z.date()` on the advertised side) fail in CI.
 */
export function toJSONSchema(definition: AnyToolDefinition): {
  readonly input: JSONSchemaResolution;
  readonly output: JSONSchemaResolution | undefined;
} {
  return notImplemented("toJSONSchema");
}
