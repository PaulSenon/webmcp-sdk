import { z } from "zod";
import { contract } from "webmcp-sdk";
import { createToolCatalog, type ToolCallResult, type ToolId } from "webmcp-sdk/consumer";
import type { Equal, Expect } from "./_utils.js";

const searchContract = contract({
  name: "search",
  description: "Search.",
  input: z.object({ q: z.string(), limit: z.number().default(10) }),
  output: z.object({ hits: z.array(z.string()) }),
});

const catalog = createToolCatalog();

// --- Unknown tools: everything is `unknown` -----------------------------------
const snapshot = catalog.getSnapshot();
const first = snapshot.tools[0];
if (first) {
  const r = await first.call({ anything: true });
  type _r = Expect<Equal<typeof r, ToolCallResult<unknown>>>;
  if (r.ok) {
    // @ts-expect-error discovered results are unknown until you validate them
    r.value.hits;
  }
}

// Ids are opaque, not plain strings.
declare function takesId(id: ToolId): void;
// @ts-expect-error a string is not a ToolId
takesId("search");
if (first) takesId(first.id);

// --- Known tools: typed by contract, checked at runtime -------------------------
const search = catalog.bindContract(searchContract);
const res = await search.call({ q: "shoes" }); // `limit` optional on the agent side (default)
if (res.ok) {
  type _v = Expect<Equal<typeof res.value, { hits: string[] }>>;
} else if (res.error.kind === "unresolved") {
  type _c = Expect<Equal<typeof res.error.candidates, readonly ToolId[]>>;
}
// @ts-expect-error input checked against the contract
search.call({ query: "shoes" });

// --- Framework-agnostic mapping ---------------------------------------------------
catalog.subscribe(({ tools }) => {
  const forAgent = tools.map((t) => ({
    name: t.uniqueName,
    description: t.description,
    parameters: t.inputSchema,
    execute: (args: unknown) => t.call(args),
  }));
  void forAgent;
});

// --- Optional input schema keeps its argument type (SOL #5) ----------------------
declare const maybeInput: z.ZodObject<{ q: z.ZodString }> | undefined;
const optional = contract({ name: "optional", description: "x", input: maybeInput });
catalog.bindContract(optional).call({ q: "hello" });
