import { z } from "zod";
import {
  defineTool,
  implementTool,
  registerTools,
  runTool,
  isToolFailureEnvelope,
  ToolError,
  type ToolFailure,
  type ToolRegistrationSnapshot,
  type ToolRunResult,
} from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

const search = defineTool({ name: "search", description: "x", input: z.object({ q: z.string() }), output: z.object({ hits: z.array(z.string()) }) });
const ping = defineTool({ name: "ping", description: "x" });
interface Dashboard { apply(f: string): number }
const applyFilter = defineTool({ name: "apply_filter", description: "x", input: z.object({ filter: z.string() }), output: z.object({ count: z.number() }) });

// One factory per implementation
const applyFilterTool = ({ dashboard }: { dashboard: Dashboard }) =>
  implementTool(applyFilter, ({ filter }) => ({ count: dashboard.apply(filter) }));
const searchTool = implementTool(search, async ({ q }) => ({ hits: [q] }));
const pingTool = implementTool(ping, () => "pong");
declare const dashboard: Dashboard;

const reg = registerTools([searchTool, pingTool, applyFilterTool({ dashboard })]);
reg.update([searchTool, applyFilterTool({ dashboard })]);
// @ts-expect-error missing dependency is a compile error at the factory call
applyFilterTool({});

const snap: ToolRegistrationSnapshot = reg.getSnapshot();
type _state = Expect<Equal<(typeof snap.tools)[number]["state"], "pending" | "registered" | "unsupported" | "error">>;
const p: Promise<ToolRegistrationSnapshot> = reg.settled();
reg.subscribe((s) => s.supported);
registerTools([pingTool], { signal: new AbortController().signal, exposedTo: ["https://a.example"], onToolError: (e, info) => info.kind });

// --- Duplicate names --------------------------------------------------------------------
const pingAgain = implementTool(defineTool({ name: "ping", description: "y" }), () => null);
// @ts-expect-error duplicate tool name "ping"
registerTools([pingTool, pingAgain]);
// @ts-expect-error duplicate in update too
reg.update([pingTool, pingAgain]);
declare const aOrB: "a" | "b";
const a = implementTool(defineTool({ name: "a", description: "x" }), () => null);
const ab = implementTool(defineTool({ name: aOrB, description: "x" }), () => null);
// @ts-expect-error potential duplicate, any order
registerTools([ab, a]);

// --- runTool: typed result, unknown input -------------------------------------------------
const r = await runTool(searchTool, { q: "shoes" });
type _r = Expect<Equal<typeof r, ToolRunResult<typeof search>>>;
if (r.ok) {
  type _v = Expect<Equal<typeof r.value, { hits: string[] }>>;
} else if (r.failure.kind === "input_invalid") {
  type _hc = Expect<Equal<typeof r.failure.handlerCalled, false>>;
}

// --- Errors ------------------------------------------------------------------------------
new ToolError("Only 2 left.", { code: "OUT_OF_STOCK", data: { left: 2 } });
// @ts-expect-error message is required
new ToolError();
// @ts-expect-error data must be JSON
new ToolError("x", { data: { when: new Date() } });
class OutOfStockError extends ToolError {
  constructor(readonly sku: string, left: number) {
    super(`Only ${left} left for ${sku}.`, { code: "OUT_OF_STOCK", data: { sku, left } });
  }
}
void new OutOfStockError("TEE-1", 2);
declare const value: unknown;
if (isToolFailureEnvelope(value)) {
  type _f = Expect<Equal<typeof value.error, ToolFailure>>;
}
