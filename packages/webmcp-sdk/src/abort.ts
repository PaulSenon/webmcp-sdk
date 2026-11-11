/** @internal Stop waiting on abort; continue observing settlement and remove the listener. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
  });
}
