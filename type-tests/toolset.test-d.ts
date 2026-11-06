import { z } from "zod";
import { contract, implement, tool, toolset, type ToolsetContext } from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

interface Cart { add(sku: string): number }
interface User { id: string }

const addToCart = contract({
  name: "add_to_cart",
  description: "Add to cart.",
  input: z.object({ sku: z.string() }),
  output: z.object({ size: z.number() }),
});

const addImpl = implement(addToCart)
  .$context<{ cart: Cart }>()
  .handler(({ input, context, signal }) => {
    type _s = Expect<Equal<typeof signal, AbortSignal>>;
    return { size: context.cart.add(input.sku) };
  });

const whoAmI = tool({ name: "who_am_i", description: "Current user." })
  .$context<{ user: User }>()
  .handler(({ context }) => context.user.id);

const ping = tool({ name: "ping", description: "Ping." }).handler(() => "pong");

// --- Context merging ---------------------------------------------------------
type _ctx = Expect<Equal<ToolsetContext<[typeof addImpl, typeof whoAmI, typeof ping]>, { cart: Cart; user: User }>>;
type _ctxEmpty = Expect<Equal<ToolsetContext<[typeof ping]>, {}>>;

const shop = toolset([addImpl, whoAmI, ping]);
declare const cart: Cart;
declare const user: User;

shop.register({ context: () => ({ cart, user }) });
shop.register({ context: async () => ({ cart, user }) });

// @ts-expect-error context is required when tools declare one
shop.register();
// @ts-expect-error context missing `user`
shop.register({ context: () => ({ cart }) });

// No context needed: options are optional
const plain = toolset([ping]);
plain.register();
plain.register({ ifUnsupported: "skip", signal: new AbortController().signal });

// --- Handler context is not available without $context ------------------------
tool({ name: "no_ctx", description: "x" }).handler(({ context }) => {
  type _c = Expect<Equal<typeof context, {}>>;
  return null;
});

// --- Duplicate literal names are a compile error --------------------------------
const pingAgain = tool({ name: "ping", description: "Another ping." }).handler(() => "pong");
// @ts-expect-error duplicate tool name "ping"
toolset([ping, pingAgain]);

// Computed (non-literal) names are only checked at registration.
declare const dynamicName: string;
const dyn = tool({ name: dynamicName, description: "x" }).handler(() => null);
toolset([dyn, ping]);
