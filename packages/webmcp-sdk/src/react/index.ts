/**
 * `webmcp-sdk/react`: React bindings over the framework-agnostic core (`registerTool`,
 * `createToolCatalog`). They own lifecycles, so you never register, unregister or dispose
 * by hand.
 *
 * ## Publishing (`useRegisterTools`, `<RegisterTools>`)
 *
 * - **SSR / first render:** nothing happens (`supported: undefined`).
 * - **Mount:** each tool is registered with its own `AbortController`. **Unmount:** they
 *   are all aborted.
 * - **Re-render:** tools are matched by **definition identity**. Implementations recreated by
 *   factories only refresh their handler (no re-registration). Added definitions are
 *   registered, and removed ones aborted. A changed definition with the same name is
 *   aborted, then registered again; the order is guaranteed.
 * - **Handlers** come from the latest commit. A call that starts between a render and its
 *   commit uses the previous handler.
 * - **StrictMode** double mount: register → abort → register, with no spurious `duplicate_name`.
 * - **Running calls** are never cancelled by unmount or re-render (WebMCP semantics).
 * - **Keep definitions at module scope.** A definition created during render is a new tool on
 *   every render (a dev warning is logged).
 * - **Errors** never throw during render. They appear per tool in the returned state. A
 *   `duplicate_name` conflict with another registration made through this SDK (in the same
 *   model context) is retried when that registration ends. Conflicts with other code stay
 *   errors.
 * - **No WebMCP:** `supported: false`. A polyfill installed later is picked up on a later render.
 *
 * ## Discovering (`useToolCatalog`)
 *
 * Creates one catalog for the component's lifetime (lazily, in state) and subscribes to it.
 * It never calls `dispose()`: a catalog without subscribers is idle (no listener, no work), so
 * unmounting releases everything, and the StrictMode double effect (unsubscribe → subscribe)
 * keeps the same working instance. `fromOrigins` is compared by value, so inline arrays are
 * fine. The returned `catalog` is the instance to call. Use one catalog per page or model:
 * create it once and pass `catalog` down instead of creating several.
 */
import type { ReactNode } from "react";
import type {
  AnyToolImplementation,
  RegisterToolOptions,
  ToolCatalog,
  ToolCatalogOptions,
  ToolCatalogSnapshot,
  RegistrationError,
  UniqueToolNames,
} from "../index.js";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createToolCatalog } from "../catalog.js";
import { registerTool, registrationConflictEnded } from "../register.js";
import { forwardingImplementation, implementationHandler } from "../implement.js";
import { defaultPublisher } from "../context.js";
import { normalizeOrigins } from "../internal.js";
import { WebMCPError } from "../errors.js";
import type { AnyToolDefinition } from "../define.js";

// React effects run only on clients. Choosing this once also avoids SSR layout warnings.
const useCommit = typeof window === "undefined" ? useEffect : useLayoutEffect;
declare const process: { env: { NODE_ENV?: string } };
const originsKey = (value?: readonly string[]) => JSON.stringify(normalizeOrigins(value));
type Entry = {
  controller: AbortController;
  implementation: AnyToolImplementation;
  state: RegisteredToolState;
};

/** Per-tool state reported by {@link useRegisterTools}. */
export type RegisteredToolState =
  | { readonly name: string; readonly state: "pending" | "registered" | "unsupported"; readonly error?: undefined }
  | { readonly name: string; readonly state: "error"; readonly error: RegistrationError };

export interface RegisteredToolsState {
  /** `undefined` before the first effect (SSR, first render), then whether WebMCP is available. */
  readonly supported: boolean | undefined;
  readonly tools: readonly RegisteredToolState[];
}

/**
 * Options for {@link useRegisterTools}. Changing `modelContext` or `exposedTo` (compared by
 * value) re-registers. `enabled` and `onUnexpectedError` apply on the next commit.
 */
export interface UseRegisterToolsOptions extends Omit<RegisterToolOptions, "signal"> {
  /** `false` unregisters every tool of this hook. Default `true`. */
  readonly enabled?: boolean;
}

/**
 * Registers tools while the component is mounted and keeps them in sync with each render.
 *
 * @example
 * function Dashboard({ dashboard }: { dashboard: DashboardStore }) {
 *   const { supported } = useRegisterTools([applyFilterTool({ dashboard }), pingTool]);
 *   …
 * }
 */
export function useRegisterTools<const T extends readonly AnyToolImplementation[]>(
  tools: T & UniqueToolNames<T>,
  options?: UseRegisterToolsOptions,
): RegisteredToolsState {
  const entries = useRef(new Map<AnyToolDefinition, Entry>());
  const committed = useRef<UseRegisterToolsOptions | undefined>(undefined);
  const configuration = useRef<{ context: UseRegisterToolsOptions["modelContext"]; exposure: string } | undefined>(undefined);
  const churn = useRef(new Map<string, { definition: AnyToolDefinition; count: number }>());
  const [state, setState] = useState<RegisteredToolsState>({ supported: undefined,
    tools: tools.map(tool => ({ name: tool.name, state: "pending" })) });
  const alive = useRef(false);
  const ordered = useRef(tools);
  const blocked = useRef(new Map<string, RegisteredToolState>());
  const duplicates = useRef(new Map<number, RegisteredToolState>());
  const publish = () => {
    if (!alive.current) return;
    const next: RegisteredToolsState = { supported: !!configuration.current?.context,
      tools: committed.current?.enabled === false ? [] : ordered.current.map((tool, i) => duplicates.current.get(i) ?? blocked.current.get(tool.name) ?? entries.current.get(tool.definition)?.state ?? { name: tool.name, state: "pending" }) };
    setState(old => old.supported === next.supported && old.tools.length === next.tools.length &&
      old.tools.every((tool, i) => sameToolState(tool, next.tools[i]!)) ? old : next);
  };
  useCommit(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const entry of entries.current.values()) entry.controller.abort();
      entries.current.clear();
      configuration.current = undefined;
    };
  }, []);
  useCommit(() => {
    committed.current = options;
    ordered.current = tools;
    duplicates.current.clear();
    const seen = new Set<string>();
    const unique = tools.filter((tool, i) => {
      if (seen.has(tool.name)) {
        duplicates.current.set(i, { name: tool.name, state: "error", error: new WebMCPError("duplicate_name", "Duplicate tool name in list.", { toolName: tool.name }) as RegistrationError });
        return false;
      }
      seen.add(tool.name); return true;
    });
    const nextChurn = new Map<string, { definition: AnyToolDefinition; count: number }>();
    for (const tool of unique) {
      const previous = churn.current.get(tool.name);
      const count = previous && previous.definition !== tool.definition ? previous.count + 1 : 0;
      warnOnDefinitionChurn(tool.name, count);
      if (count > 3 && !blocked.current.has(tool.name)) blocked.current.set(tool.name, {
        name: tool.name, state: "error", error: new WebMCPError("registration_failed", `Define tool "${tool.name}" at module scope.`, { toolName: tool.name }) as RegistrationError,
      });
      nextChurn.set(tool.name, { definition: tool.definition, count });
    }
    churn.current = nextChurn;

    const context = options?.modelContext ?? defaultPublisher();
    const exposure = originsKey(options?.exposedTo);
    const reset = configuration.current?.context !== context || configuration.current?.exposure !== exposure;
    configuration.current = { context, exposure };
    const wanted = new Set(options?.enabled === false ? [] : unique.filter(tool => !blocked.current.has(tool.name)).map(tool => tool.definition));
    for (const [definition, entry] of entries.current) {
      if (reset || !wanted.has(definition)) { entry.controller.abort(); entries.current.delete(definition); }
    }
    for (const tool of unique) {
      if (!wanted.has(tool.definition)) continue;
      const old = entries.current.get(tool.definition);
      if (old) { old.implementation = tool; continue; }
      const entry: Entry = { controller: new AbortController(), implementation: tool,
        state: { name: tool.name, state: "pending" } };
      entries.current.set(tool.definition, entry);
      startRegistration(entry, tool, { ...options, ...(context ? { modelContext: context } : {}) }, () => committed.current, publish);
    }
    publish();
  });
  return state;
}

function sameToolState(a: RegisteredToolState, b: RegisteredToolState): boolean {
  return a.name === b.name && a.state === b.state && a.error?.code === b.error?.code && a.error?.message === b.error?.message;
}

function startRegistration(entry: Entry, tool: AnyToolImplementation, options: UseRegisterToolsOptions,
  committed: () => UseRegisterToolsOptions | undefined, publish: () => void) {
  const context = options.modelContext;
  const wrapper = forwardingImplementation(tool, () => implementationHandler(entry.implementation));
  const attempt = () => {
    if (entry.controller.signal.aborted) return;
    void registerTool(wrapper, { signal: entry.controller.signal,
      ...(context ? { modelContext: context } : {}),
      ...(options.exposedTo ? { exposedTo: [...options.exposedTo] } : {}),
      onUnexpectedError: (error, info) => committed()?.onUnexpectedError?.(error, info),
    }).then(status => {
      if (entry.controller.signal.aborted) return;
      entry.state = { name: tool.name, state: status }; publish();
    }, (error: RegistrationError) => {
      if (entry.controller.signal.aborted) return;
      entry.state = { name: tool.name, state: "error", error }; publish();
      const ended = registrationConflictEnded(error);
      if (ended) ended.subscribe(() => {
        if (entry.controller.signal.aborted) return;
        entry.state = { name: tool.name, state: "pending" }; publish(); attempt();
      }, entry.controller.signal);
    });
  };
  attempt();
}

function warnOnDefinitionChurn(name: string, count: number) {
  let env: string | undefined;
  try { env = process.env.NODE_ENV; } catch { /* unbundled browser */ }
  if (env !== "production" && count === 3) console.warn(`webmcp-sdk: definition "${name}" changes identity on consecutive commits; keep definitions at module scope.`);
}

export type RegisterToolsProps<T extends readonly AnyToolImplementation[]> = UseRegisterToolsOptions & {
  readonly tools: T & UniqueToolNames<T>;
  /** Rendered as-is. The component adds no DOM. */
  readonly children?: ReactNode;
};

/**
 * Component form of {@link useRegisterTools}: the tools are registered while it is mounted.
 *
 * @example
 * {cart.items.length > 0 && <RegisterTools tools={[checkoutTool({ cart })]} />}
 */
export function RegisterTools<const T extends readonly AnyToolImplementation[]>(props: RegisterToolsProps<T>): ReactNode {
  const { tools, children, ...options } = props;
  useRegisterTools<T>(tools, options);
  return children;
}

/** What {@link useToolCatalog} returns: the current snapshot, plus the catalog it owns. */
export interface UseToolCatalogResult extends ToolCatalogSnapshot {
  /** Stable for the component's lifetime. Use it for `callTool`, `isCatalogTool`, `getTools`. */
  readonly catalog: ToolCatalog;
}

/**
 * Discovers the tools available to this page and re-renders when they change. EXPERIMENTAL.
 * `maxNameLength` and `namePrefix` are read once, at creation.
 *
 * @example
 * const { status, tools, catalog } = useToolCatalog({ fromOrigins: ["https://widgets.example"] });
 */
export function useToolCatalog(options?: ToolCatalogOptions): UseToolCatalogResult {
  const [catalog] = useState(() => createToolCatalog(options));
  const snapshot = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot, catalog.getSnapshot);
  const origins = originsKey(options?.fromOrigins);
  useCommit(() => { catalog.update({ ...(options?.fromOrigins ? { fromOrigins: options.fromOrigins } : {}) }); }, [catalog, origins]);
  return { ...snapshot, catalog };
}
