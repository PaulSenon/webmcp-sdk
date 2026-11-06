import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import {
  contract,
  implement,
  tool,
  withJsonSchema,
  type InferHandlerInput,
  type InferHandlerOutput,
  type InferToolInput,
  type InferToolOutput,
  type NoArguments,
  type StandardSchemaV1,
} from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

// --- Zod: input/output sides with transforms and defaults ---------------------
const addToCart = contract({
  name: "add_to_cart",
  description: "Add a product to the cart.",
  input: z.object({
    sku: z.string(),
    quantity: z.number().int().default(1),
  }),
  output: z.object({ addedAt: z.date().transform((d) => d.toISOString()) }),
});

type _name = Expect<Equal<typeof addToCart.name, "add_to_cart">>;
// Agent may omit `quantity` (default); handler always gets it.
type _toolIn = Expect<Equal<InferToolInput<typeof addToCart>, { sku: string; quantity?: number | undefined }>>;
type _handlerIn = Expect<Equal<InferHandlerInput<typeof addToCart>, { sku: string; quantity: number }>>;
// Handler returns the output schema's input side (Date), agent receives its output side (string).
type _handlerOut = Expect<Equal<InferHandlerOutput<typeof addToCart>, { addedAt: Date }>>;
type _toolOut = Expect<Equal<InferToolOutput<typeof addToCart>, { addedAt: string }>>;

implement(addToCart).handler(({ input }) => {
  type _i = Expect<Equal<typeof input, { sku: string; quantity: number }>>;
  return { addedAt: new Date() };
});

// @ts-expect-error handler must return the output schema's input type (Date, not string)
implement(addToCart).handler(() => ({ addedAt: "2026-01-01" }));

// @ts-expect-error missing output field
implement(addToCart).handler(async () => ({}));

// --- No input / no output ----------------------------------------------------
const ping = tool({ name: "ping", description: "Health check." }).handler(({ input }) => {
  type _i = Expect<Equal<typeof input, NoArguments>>;
  return "pong";
});
type _pingOut = Expect<Equal<InferToolOutput<typeof ping.contract>, unknown>>;

// --- Valibot: needs the official JSON Schema adapter -------------------------
const ValibotInput = v.object({ query: v.pipe(v.string(), v.minLength(1)) });

contract({
  name: "search",
  description: "Search the catalog.",
  input: toStandardJsonSchema(ValibotInput),
});

contract({
  name: "search",
  description: "Search the catalog.",
  // @ts-expect-error validation-only Standard Schema: no JSON Schema capability
  input: ValibotInput,
});

// --- ArkType: native -----------------------------------------------------------
const ark = contract({
  name: "ark",
  description: "ArkType tool.",
  input: type({ id: "string", "limit?": "number" }),
});
type _arkIn = Expect<Equal<InferHandlerInput<typeof ark>, { id: string; limit?: number }>>;

// --- withJsonSchema: escape hatch for any Standard Schema ---------------------
declare const customSchema: StandardSchemaV1<{ q: string }, { q: string; normalized: true }>;
const custom = contract({
  name: "custom",
  description: "Hand-written JSON Schema.",
  input: withJsonSchema(customSchema, {
    input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  }),
});
type _customIn = Expect<Equal<InferHandlerInput<typeof custom>, { q: string; normalized: true }>>;

// --- Input must be an object ----------------------------------------------------
contract({
  name: "bad",
  description: "x",
  // @ts-expect-error tool arguments must be a JSON object
  input: z.string(),
});

contract({
  name: "bad",
  description: "x",
  // @ts-expect-error arrays are not valid top-level arguments
  input: z.array(z.string()),
});

// --- Required metadata -----------------------------------------------------------
// @ts-expect-error description is required
contract({ name: "no_description" });

// @ts-expect-error empty name
contract({ name: "", description: "x" });
// @ts-expect-error empty name, through tool() too
tool({ name: "", description: "x" });
// @ts-expect-error empty name, nested in implement()
implement(contract({ name: "", description: "x" }));

// --- Nested contract() keeps literal names (SOL #1) ------------------------------
const nested = implement(contract({ name: "nested", description: "x" })).handler(() => null);
type _nested = Expect<Equal<typeof nested.name, "nested">>;

// --- Interface-typed schemas are accepted (SOL #2) --------------------------------
interface Args { q: string }
declare const ifaceSchema: StandardSchemaV1<Args>;
contract({
  name: "iface",
  description: "x",
  input: withJsonSchema(ifaceSchema, { input: { type: "object" } }),
});

// --- Degenerate inputs are rejected (SOL #2) ---------------------------------------
// @ts-expect-error any input
contract({ name: "any", description: "x", input: z.any() });
// @ts-expect-error never input
contract({ name: "never", description: "x", input: z.never() });
// @ts-expect-error array input type hidden behind an intersection
contract({ name: "arr", description: "x", input: z.intersection(z.array(z.string()), z.record(z.string(), z.unknown())) });

// --- Without an output schema, handlers return JSON (SOL #7) ----------------------
const free = contract({ name: "free", description: "x" });
implement(free).handler(() => ({ ok: true, items: [1, 2] }));
implement(free).handler(() => {}); // void is sent as null
implement(free).handler(async () => {});
// @ts-expect-error bigint is not JSON
implement(free).handler(() => 1n);
// @ts-expect-error functions are not JSON
implement(free).handler(() => () => 1);
// @ts-expect-error Date is not JSON (declare an output schema with a transform instead)
implement(free).handler(() => new Date());
