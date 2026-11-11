import type { ModelContextLike, ModelContextConsumerLike } from "./model-context.js";
/** @internal */
function lookup(): Partial<ModelContextLike & ModelContextConsumerLike> | undefined {
  return typeof document === "undefined" ? undefined : (document as Document & { modelContext?: ModelContextLike & ModelContextConsumerLike }).modelContext;
}
/** @internal */
export function defaultPublisher(): ModelContextLike | undefined {
  const context = lookup();
  return typeof context?.registerTool === "function" ? context as ModelContextLike : undefined;
}
/** @internal */
export function defaultConsumer(): ModelContextConsumerLike | undefined {
  const context = lookup();
  return typeof context?.getTools === "function" && typeof context.executeTool === "function" ? context as ModelContextConsumerLike : undefined;
}
