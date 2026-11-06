import { z } from "zod";
import { contract, implement, tool, toolset, type AnyToolImplementation, type ToolsetContext } from "webmcp-sdk";
import type { Equal, Expect, Same } from "./_utils.js";

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
type _ctx = Expect<Same<ToolsetContext<[typeof addImpl, typeof whoAmI, typeof ping]>, { cart: Cart; user: User }>>;
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
// @ts-expect-error potential duplicate tool name "ping"
toolset([ping, pingAgain]);

// Computed (non-literal) names are only checked at registration.
declare const dynamicName: string;
const dyn = tool({ name: dynamicName, description: "x" }).handler(() => null);
toolset([dyn, ping]);

// --- Union and callable contexts survive merging (SOL #3) --------------------------
const unionCtx = tool({ name: "u", description: "x" })
  .$context<{ kind: "a"; a: string } | { kind: "b"; b: number }>()
  .handler(() => null);
toolset([unionCtx]).register({ context: () => ({ kind: "a" as const, a: "x" }) });

const fnCtx = tool({ name: "f", description: "x" })
  .$context<() => string>()
  .handler(({ context }) => context().toUpperCase());
// @ts-expect-error callable context is still required
toolset([fnCtx]).register();
// @ts-expect-error wrong callable context
toolset([fnCtx]).register({ context: () => 42 });
toolset([fnCtx]).register({ context: () => () => "ok" });

// --- Erased arrays fail closed (SOL #4) -------------------------------------------
const req = tool({ name: "req", description: "x" })
  .$context<{ a: string }>()
  .handler(({ context }) => context.a);
const erased: AnyToolImplementation[] = [req];
// @ts-expect-error requirements are unknowable for an erased array
toolset(erased).register();
const kept = [req] satisfies AnyToolImplementation[];
toolset(kept).register({ context: () => ({ a: "x" }) });

// --- Union / template names: potential overlaps are reported in any order (SOL #6)
const a = tool({ name: "a", description: "x" }).handler(() => null);
declare const aOrB: "a" | "b";
const ab = tool({ name: aOrB, description: "x" }).handler(() => null);
// @ts-expect-error potential duplicate
toolset([a, ab]);
// @ts-expect-error potential duplicate
toolset([ab, a]);
