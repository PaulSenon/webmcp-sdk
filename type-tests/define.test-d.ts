import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import {
  defineTool,
  implementTool,
  withJsonSchema,
  type InferHandlerInput,
  type InferHandlerOutput,
  type InferToolInput,
  type InferToolOutput,
  type NoArguments,
  type StandardSchemaV1,
} from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

// --- Input/output sides with transforms and defaults ------------------------------
const addToCart = defineTool({
  name: "add_to_cart",
  description: "Add a product to the cart.",
  input: z.object({ sku: z.string(), quantity: z.number().int().default(1) }),
  output: z.object({ addedAt: z.date().transform((d) => d.toISOString()) }),
});
type _name = Expect<Equal<typeof addToCart.name, "add_to_cart">>;
type _toolIn = Expect<Equal<InferToolInput<typeof addToCart>, { sku: string; quantity?: number | undefined }>>;
type _handlerIn = Expect<Equal<InferHandlerInput<typeof addToCart>, { sku: string; quantity: number }>>;
type _handlerOut = Expect<Equal<InferHandlerOutput<typeof addToCart>, { addedAt: Date }>>;
type _toolOut = Expect<Equal<InferToolOutput<typeof addToCart>, { addedAt: string }>>;

// --- No input / no output --------------------------------------------------------
const ping = defineTool({ name: "ping", description: "Health check." });
type _pingIn = Expect<Equal<InferHandlerInput<typeof ping>, NoArguments>>;
type _pingOut = Expect<Equal<InferToolOutput<typeof ping>, unknown>>;

// --- Library support: native, adapter, escape hatch -------------------------------
defineTool({ name: "ark", description: "x", input: type({ id: "string", "limit?": "number" }) });
defineTool({ name: "vali", description: "x", input: toStandardJsonSchema(v.object({ q: v.string() })) });
defineTool({
  name: "vali_raw",
  description: "x",
  // @ts-expect-error validation-only schema: no JSON Schema capability
  input: v.object({ q: v.string() }),
});
interface Args { q: string }
declare const ifaceSchema: StandardSchemaV1<Args>;
defineTool({ name: "iface", description: "x", input: withJsonSchema(ifaceSchema, { input: { type: "object" } }) });

// --- Input must be an object --------------------------------------------------------
// @ts-expect-error non-object input
defineTool({ name: "a", description: "x", input: z.string() });
// @ts-expect-error array input
defineTool({ name: "b", description: "x", input: z.array(z.string()) });
// @ts-expect-error any input
defineTool({ name: "c", description: "x", input: z.any() });
// @ts-expect-error never input
defineTool({ name: "d", description: "x", input: z.never() });
declare const maybeInput: z.ZodObject<{ q: z.ZodString }> | undefined;
const optional = defineTool({ name: "optional", description: "x", input: maybeInput });
type _optIn = Expect<Equal<InferToolInput<typeof optional>, { q: string } | NoArguments>>;

// --- Metadata ------------------------------------------------------------------------
// @ts-expect-error description is required
defineTool({ name: "no_description" });
// @ts-expect-error empty name
defineTool({ name: "", description: "x" });
declare const dynamicName: string;
defineTool({ name: dynamicName, description: "wide names are checked at runtime" });

// --- Handlers ---------------------------------------------------------------------------
implementTool(addToCart, (input, { signal }) => {
  type _i = Expect<Equal<typeof input, { sku: string; quantity: number }>>;
  type _s = Expect<Equal<typeof signal, AbortSignal>>;
  return { addedAt: new Date() };
});
// @ts-expect-error handler returns the output schema's input side (Date), not a string
implementTool(addToCart, () => ({ addedAt: "2026-01-01" }));
// @ts-expect-error missing field (async)
implementTool(addToCart, async () => ({}));
implementTool(ping, () => ({ ok: true, items: [1, 2] }));
implementTool(ping, () => {}); // void → null
implementTool(ping, async () => {});
// @ts-expect-error bigint is not JSON
implementTool(ping, () => 1n);
// @ts-expect-error Date is not JSON (declare an output schema with a transform)
implementTool(ping, () => new Date());

// --- Declined confirmation: a normal output declared by the author -------------------
const checkout = defineTool({
  name: "checkout",
  description: "Place the order after user confirmation.",
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("placed"), orderId: z.string() }),
    z.object({ status: z.literal("declined"), message: z.string() }),
  ]),
});
implementTool(checkout, () => ({ status: "declined", message: "The user declined." }));
// @ts-expect-error not one of the declared outcomes
implementTool(checkout, () => ({ status: "cancelled" }));

// --- Regression: literal returns keep their types without `as const` (NoInfer on the handler) ---
declare const flag2: boolean;
const outcome = z.discriminatedUnion("status", [z.object({ status: z.literal("placed"), orderId: z.string() }), z.object({ status: z.literal("declined"), message: z.string() })]);
const litA = defineTool({ name: "lit_a", description: "x", input: z.object({ id: z.string() }), output: outcome });
implementTool(litA, async ({ id }) => { if (flag2) return { status: "declined", message: id }; return { status: "placed", orderId: id }; });
implementTool(litA, async () => ({ status: "declined", message: "x" }));
const litB = defineTool({ name: "lit_b", description: "x", output: z.object({ state: z.enum(["open", "closed"]), tags: z.array(z.string()) }) });
implementTool(litB, () => ({ state: "open", tags: [] }));
// @ts-expect-error missing field
implementTool(litB, async () => ({ state: "open" }));
// @ts-expect-error wrong literal
implementTool(litB, () => ({ state: "nope", tags: [] }));
// @ts-expect-error not declared outcome
implementTool(litA, async () => ({ status: "cancelled" }));
