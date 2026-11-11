// Module-level WeakMaps: pending (attempts), owners (live registrations), conflicts (owner lifetimes).
import { withAbort } from "./abort.js";
import type { ModelContextLike } from "./model-context.js";
// Internal coordination only: pending settlement and active ownership, per context/name.
/** @internal */
interface RegistryEntry {
  promise: Promise<unknown>;
  signal: AbortSignal | undefined;
  ended: Lifetime;
  end(): void;
}
/** @internal */
const pending = new WeakMap<ModelContextLike, Map<string, Set<RegistryEntry>>>();
/** @internal */
const conflicts = new WeakMap<object, Lifetime>();
/** @internal only SDK-owned conflicts have a lifetime to wait for. */
export function registrationConflictEnded(error: object): Lifetime | undefined {
  return conflicts.get(error);
}
/** @internal */
const owners = new WeakMap<ModelContextLike, Map<string, RegistryEntry>>();
/** @internal */
interface Lifetime { subscribe(callback: () => void, signal: AbortSignal): void; }
/** @internal */
function lifetime(): { ended: Lifetime; end(): void } {
  const listeners = new Set<() => void>();
  let done = false;
  return { ended: { subscribe(callback, signal) {
    if (signal.aborted) return;
    if (done) { callback(); return; }
    const abort = () => { listeners.delete(notify); };
    const notify = () => { signal.removeEventListener("abort", abort); callback(); };
    listeners.add(notify); signal.addEventListener("abort", abort, { once: true });
  } }, end() { done = true; for (const listener of listeners) listener(); listeners.clear(); } };
}

/** @internal Coordinate native settlement separately from live ownership. */
export function coordinateRegistration<T>(context: ModelContextLike, name: string, signal: AbortSignal | undefined,
  operation: () => Promise<T>): Promise<T> {
  let names = pending.get(context);
  if (!names) { names = new Map(); pending.set(context, names); }
  let attempts = names.get(name);
  if (!attempts) { attempts = new Set(); names.set(name, attempts); }
  const previous = [...attempts].filter(attempt => attempt.signal?.aborted);
  let live = owners.get(context);
  if (!live) { live = new Map(); owners.set(context, live); }
  let entry!: RegistryEntry;
  const work = (async () => {
    if (previous.length) await Promise.all(previous.map(attempt => attempt.promise.catch(() => {})));
    signal?.throwIfAborted();
    try {
      const result = await operation();
      live.set(name, entry);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      const owner = live.get(name);
      if (error && typeof error === "object" && "code" in error && error.code === "duplicate_name" && owner && !owner.signal?.aborted)
        conflicts.set(error, owner.ended);
      throw error;
    }
  })();
  const { ended, end } = lifetime();
  entry = { promise: work, signal, ended, end };
  attempts.add(entry);
  const settled = () => {
    attempts.delete(entry);
    if (!attempts.size && names.get(name) === attempts) names.delete(name);
  };
  const release = () => {
    settled();
    if (live.get(name) === entry) live.delete(name);
    signal?.removeEventListener("abort", onAbort);
    entry.end();
  };
  // Retain pending settlement even if abort wins the SDK-facing promise.
  const onAbort = () => { void work.then(release, release); };
  signal?.addEventListener("abort", onAbort, { once: true });
  void work.then(() => { settled(); if (signal?.aborted) release(); }, release);
  return withAbort(work, signal);
}
