import { useState } from "react";
import { z } from "zod";
import { defineTool, implementTool, type ToolRegistrationSnapshot } from "webmcp-sdk";
import { RegisterTools, useRegisterTools, useToolCatalog } from "webmcp-sdk/react";
import type { Equal, Expect } from "./_utils.js";

interface Cart { items: string[] }
const viewCart = defineTool({ name: "view_cart", description: "List cart items.", output: z.object({ items: z.array(z.string()) }) });
const checkout = defineTool({ name: "checkout", description: "Go to checkout." });
const viewCartTool = ({ cart }: { cart: Cart }) => implementTool(viewCart, () => ({ items: cart.items }));
const checkoutTool = ({ cart }: { cart: Cart }) => implementTool(checkout, () => cart.items.length);

export function Shop({ cart }: { cart: Cart }) {
  const [n, setN] = useState(0);
  const snap = useRegisterTools([viewCartTool({ cart })], { enabled: n >= 0, exposedTo: ["https://a.example"] });
  type _s = Expect<Equal<typeof snap, ToolRegistrationSnapshot>>;
  // @ts-expect-error duplicate names
  useRegisterTools([viewCartTool({ cart }), viewCartTool({ cart })]);

  const { status, tools, find } = useToolCatalog({ fromOrigins: ["https://widgets.example"] });
  void find(viewCart);
  setN(tools.length);

  return (
    <>
      {status === "ready" && <p>{tools.length} tools</p>}
      {cart.items.length > 0 && <RegisterTools tools={[checkoutTool({ cart })]} />}
      {/* @ts-expect-error duplicate names in the component too */}
      <RegisterTools tools={[checkoutTool({ cart }), checkoutTool({ cart })]} />
    </>
  );
}
