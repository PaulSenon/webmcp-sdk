// The official polyfill's ModelContext (via its `webmcp-types` dependency) must be accepted
// wherever this SDK takes a `modelContext` option, on both the publisher and consumer sides.
import type { WebMCP } from "@w3c/webmcp-polyfill";
import { createToolCatalog, registerTools, type ModelContextConsumerLike, type ModelContextLike } from "webmcp-sdk";

declare const mc: WebMCP.ModelContext;
const publisher: ModelContextLike = mc;
const consumer: ModelContextConsumerLike = mc;
registerTools([], { modelContext: mc });
createToolCatalog({ modelContext: mc });
void publisher;
void consumer;
