import { createToolCatalog, defineTool, type CatalogTool, type ToolCallResult } from "@senon/webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

const catalog = createToolCatalog({ fromOrigins: ["https://widgets.example"], namePrefix: "page_", maxNameLength: 64 });

// --- Snapshot: descriptions + JSON Schema, one name per tool ------------------------------
const tools = await catalog.getTools();
type _t = Expect<Equal<typeof tools, readonly CatalogTool[]>>;
const first = tools[0];
if (first) {
  const name: string = first.name;
  // The issued name goes straight back to callTool: no mapping
  const r = await catalog.callTool(name, { anything: true });
  type _r = Expect<Equal<typeof r, ToolCallResult>>;
  if (r.ok) {
    // @ts-expect-error discovered results are unknown
    r.value.hits;
  } else {
    type _k = Expect<Equal<typeof r.error.kind, "unknown_tool" | "unavailable" | "invalid_arguments" | "tool_failed" | "rejected">>;
    const message: string = r.error.message;
  }
}

// --- Opaque tool calls from a model: unknown input, no cast needed ------------------------
declare const toolCall: { toolName: string; input: unknown };
if (catalog.isCatalogTool(toolCall.toolName)) {
  await catalog.callTool(toolCall.toolName, toolCall.input);
}
await catalog.callTool("anything"); // input optional; unknown name → unknown_tool result

// --- Withdrawn APIs stay withdrawn --------------------------------------------------------
// @ts-expect-error no isAvailable: callTool answers `unavailable`
catalog.isAvailable("x");
const someDefinition = defineTool({ name: "x", description: "x" });
// @ts-expect-error no typed definition overload: callTool takes a string name
catalog.callTool(someDefinition, {});

// --- Lifecycle ------------------------------------------------------------------------------
catalog.update({ fromOrigins: [] });
const stop = catalog.subscribe((s) => s.status);
stop(); // this listener only
catalog.dispose(); // the whole catalog, including every listener
