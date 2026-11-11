import { z } from "zod";
import {
  defineTool,
  implementTool,
  isToolFailureEnvelope,
  registerTool,
  registerTools,
  runTool,
  ToolError,
  type RegisterToolsResult,
  type RegisterToolStatus,
  type ToolFailure,
  type ToolRunResult,
} from "webmcp-sdk";
import type { Equal, Expect } from "./_utils.js";

const search = defineTool({ name: "search", description: "x", input: z.object({ q: z.string() }), output: z.object({ hits: z.array(z.string()) }) });
const ping = defineTool({ name: "ping", description: "x" });
interface Dashboard { apply(f: string): number }
const applyFilter = defineTool({ name: "apply_filter", description: "x", input: z.object({ filter: z.string() }), output: z.object({ count: z.number() }) });

const applyFilterTool = ({ dashboard }: { dashboard: Dashboard }) =>
  implementTool(applyFilter, ({ filter }) => ({ count: dashboard.apply(filter) }));
const searchTool = implementTool(search, async ({ q }) => ({ hits: [q] }));
const pingTool = implementTool(ping, () => "pong");
declare const dashboard: Dashboard;

// --- One tool: native-like ---------------------------------------------------------------
const controller = new AbortController();
const status = await registerTool(searchTool, { signal: controller.signal, exposedTo: ["https://a.example"] });
type _status = Expect<Equal<typeof status, RegisterToolStatus>>;
type _statusValues = Expect<Equal<RegisterToolStatus, "registered" | "unsupported">>;
controller.abort();
// @ts-expect-error missing dependency is a compile error at the factory call
applyFilterTool({});

// --- A group: one call, one signal, per-tool results --------------------------------------
const shop = new AbortController();
const results = await registerTools([searchTool, pingTool, applyFilterTool({ dashboard })], {
  signal: shop.signal,
  onUnexpectedError: (_e, info) => info.kind,
});
type _results = Expect<Equal<typeof results, readonly RegisterToolsResult[]>>;
for (const r of results) {
  if (r.status === "error") {
    const code: "invalid_definition" | "duplicate_name" | "json_schema_unavailable" | "registration_failed" = r.error.code;
  }
}
shop.abort();

// --- Duplicate names ---------------------------------------------------------------------
const pingAgain = implementTool(defineTool({ name: "ping", description: "y" }), () => null);
// @ts-expect-error duplicate tool name "ping"
registerTools([pingTool, pingAgain]);
declare const cond: boolean;
// @ts-expect-error duplicate after a conditional spread
registerTools([...(cond ? [searchTool] : []), pingTool, pingTool]);
registerTools([pingTool].map((t) => t)); // dynamic: checked at runtime only
declare const aOrB: "a" | "b";
const a = implementTool(defineTool({ name: "a", description: "x" }), () => null);
const ab = implementTool(defineTool({ name: aOrB, description: "x" }), () => null);
// @ts-expect-error potential duplicate, any order
registerTools([ab, a]);

// --- No public update/handle: the signal is the lifetime ----------------------------------
// @ts-expect-error registerTool returns a status, not a handle
(await registerTool(pingTool)).unregister();

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
