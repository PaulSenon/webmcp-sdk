import { useState } from "react";
import { z } from "zod";
import { contract, implement, tool, toolset } from "webmcp-sdk";
import { useTool, useToolset, WebMCPTools } from "webmcp-sdk/react";
import type { Equal, Expect } from "./_utils.js";

interface Cart { size: number }

const getCart = implement(contract({ name: "get_cart", description: "Cart size." }))
  .$context<{ cart: Cart }>()
  .handler(({ context }) => context.cart.size);
const cartTools = toolset([getCart]);
const ping = toolset([tool({ name: "ping", description: "Ping." }).handler(() => "pong")]);

const addTodo = contract({
  name: "add_todo",
  description: "Add a todo.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ count: z.number() }),
});

export function Component({ cart }: { cart: Cart }) {
  const [todos, setTodos] = useState<string[]>([]);

  const status = useToolset(cartTools, { context: { cart } });
  if (status.status === "error") {
    type _e = Expect<Equal<typeof status.error.code, import("webmcp-sdk").WebMCPErrorCode>>;
  }
  useToolset(ping);
  useToolset(ping, { enabled: false });
  // @ts-expect-error context required
  useToolset(cartTools);
  // @ts-expect-error context is a value in React, not a getter
  useToolset(cartTools, { context: () => ({ cart }) });

  useTool(addTodo, ({ input }) => {
    setTodos((t) => [...t, input.text]);
    return { count: todos.length + 1 };
  });
  // @ts-expect-error wrong return type
  useTool(addTodo, () => ({ count: "1" }));

  return (
    <>
      <WebMCPTools toolset={cartTools} context={{ cart }} />
      <WebMCPTools toolset={ping} />
      {/* @ts-expect-error context required */}
      <WebMCPTools toolset={cartTools} />
    </>
  );
}
