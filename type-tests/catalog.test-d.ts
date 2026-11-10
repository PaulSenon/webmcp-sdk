import { z } from "zod";
import { createToolCatalog, defineTool, toProviderName, type ToolCallResult } from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

const searchProducts = defineTool({
  name: "search_products",
  description: "Search.",
  input: z.object({ q: z.string(), limit: z.number().default(10) }),
  output: z.object({ hits: z.array(z.string()) }),
});

const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"] });

// --- Dynamic tools: unknown, ids are plain strings ------------------------------------
const tools = await catalog.getTools();
const first = tools[0];
if (first) {
  const id: string = first.id;
  const r = await first.call({ anything: true });
  type _r = Expect<Equal<typeof r, ToolCallResult<unknown>>>;
  if (r.ok) {
    // @ts-expect-error discovered results are unknown
    r.value.hits;
  }
  await catalog.call(id, {});
  const name: string = toProviderName(id, { maxLength: 64 });
}
await catalog.call("self__whatever", {}); // plain string accepted; unknown id → not_found result

// --- Known definitions: typed, validated at runtime ---------------------------------------
const [search] = await catalog.find(searchProducts);
if (search) {
  const res = await search.call({ q: "shoes" }); // `limit` optional on the agent side
  if (res.ok) {
    type _v = Expect<Equal<typeof res.value, { hits: string[] }>>;
  } else {
    type _k = Expect<Equal<typeof res.error.kind, "not_found" | "tool_failed" | "rejected" | "input_invalid" | "output_invalid">>;
  }
  // @ts-expect-error input typed by the definition
  search.call({ query: "shoes" });
}

catalog.update({ fromOrigins: [] });
const off = catalog.subscribe((s) => s.status);
off();
catalog.dispose();
