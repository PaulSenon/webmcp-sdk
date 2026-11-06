import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { notImplemented } from "./not-implemented.js";

export type { StandardJSONSchemaV1, StandardSchemaV1 };

/**
 * A plain JSON Schema object, as sent to the browser in a tool descriptor.
 * It is deliberately loose. The SDK passes it through and does not interpret it.
 */
export type JSONSchema = { readonly [key: string]: unknown };

/**
 * A schema the SDK can both **validate with** (Standard Schema) and **describe to an
 * agent with** (Standard JSON Schema).
 *
 * These are two separate capabilities. Validation (`~standard.validate`) does not
 * imply JSON Schema export (`~standard.jsonSchema`). Tool schemas need both, so the
 * SDK requires both at compile time.
 *
 * - Zod >= 4.2 and ArkType >= 2.1 schemas implement both natively.
 * - Valibot: wrap with `toStandardJsonSchema(schema)` from `@valibot/to-json-schema`.
 * - Anything else, or a hand-written JSON Schema: wrap with {@link withJsonSchema}.
 */
export type ToolSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>;

/** A JSON value, as WebMCP serializes tool results with JSON. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Tool arguments are always a JSON object. WebMCP and MCP require the top-level
 * `inputSchema` to be `type: "object"`.
 */
export type ToolArguments = Record<string, unknown>;

/**
 * Any schema usable as a tool `input`. The base constraint is `object` (so interface
 * types are accepted). `contract()` additionally rejects `any`, `never`, arrays,
 * functions and `Date` input types at compile time. The generated JSON Schema root is
 * still checked at registration.
 */
export type AnyInputSchema = ToolSchema<object, any>;
/** Any schema usable as a tool `output`. */
export type AnyOutputSchema = ToolSchema<any, any>;

/** The input side of a schema: what callers send, before transforms. */
export type InferSchemaInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;
/** The output side of a schema: what you get after validation and transforms. */
export type InferSchemaOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : never;

/** Which JSON Schema dialect to request from Standard JSON Schema converters. */
export type JSONSchemaTarget = StandardJSONSchemaV1.Target;

/**
 * Attaches an explicit JSON Schema to a Standard Schema that cannot produce one
 * (or produces the wrong one).
 *
 * The SDK does **not** check that `jsonSchema` and `schema` agree. Validation always
 * uses `schema`. Agents only ever see `jsonSchema`. Keeping them in sync is your job.
 *
 * @example
 * const Input = withJsonSchema(myCustomSchema, {
 *   input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
 * });
 */
export function withJsonSchema<S extends StandardSchemaV1>(
  schema: S,
  jsonSchema: {
    /** JSON Schema for the input side (what agents must send). */
    readonly input: JSONSchema;
    /** JSON Schema for the output side. Defaults to `input` when omitted. */
    readonly output?: JSONSchema;
  },
): S & StandardJSONSchemaV1<InferSchemaInput<S>, InferSchemaOutput<S>> {
  return notImplemented("withJsonSchema");
}

/**
 * The result of turning a schema into JSON Schema. Conversion runs once, at
 * registration, and it can fail at runtime even when the types allow the schema
 * (for example Zod `z.date()` or a `.transform()` on the side being exported).
 */
export type JSONSchemaResolution =
  | { readonly ok: true; readonly schema: JSONSchema }
  | {
      readonly ok: false;
      /** Which side of which schema failed. */
      readonly side: "input" | "output";
      /** The converter's message. Developer-facing; never sent to agents. */
      readonly message: string;
      readonly cause: unknown;
    };
