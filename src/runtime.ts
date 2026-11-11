import type { ModelContextLike, ModelContextConsumerLike } from "./model-context.js";
export function defaultContext(): (ModelContextLike & ModelContextConsumerLike) | undefined {
  return typeof document === "undefined" ? undefined :
    (document as Document & { modelContext?: ModelContextLike & ModelContextConsumerLike }).modelContext;
}
/** Stop waiting on abort; retain observation of native settlement for coordination. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
  });
}
