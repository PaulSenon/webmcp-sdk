/**
 * `webmcp-sdk/react`: React bindings. They only orchestrate lifecycle and reactivity on
 * top of the framework-agnostic core (`registerTools`, `createToolCatalog`). They never
 * re-implement core logic.
 *
 * ## Publishing lifecycle (`useRegisterTools`, `<RegisterTools>`)
 *
 * - **SSR and first render:** nothing happens. The snapshot is `{ supported: undefined, tools: [] }`.
 * - **Mount:** a core registration is created in an effect. **Unmount:** `unregister()`.
 * - **After every commit:** `update(tools)`. The core matches tools by **definition
 *   identity**: implementations recreated on each render (factories) refresh handlers
 *   without re-registering. Only added or removed definitions are registered or unregistered.
 * - **Handlers** therefore always come from the latest commit. A call that starts between a
 *   render and its commit uses the previous handler.
 * - **StrictMode:** mount → unmount → mount means register, unregister, register. The core's
 *   per-name queue prevents a spurious `duplicate_name`.
 * - **Running calls** are never aborted by unmount or update. A handler that must stop when
 *   its component goes away needs its own `AbortController`, owned by your code.
 * - **Keep definitions stable** (module scope). A definition created during render is a new
 *   tool on every render, so it is re-registered every time (a dev warning is logged).
 * - **Errors** never throw during render. They appear per tool in the snapshot.
 *
 * ## Discovery lifecycle (`useToolCatalog`)
 *
 * The catalog is created once per component (lazy, so nothing happens during render) and
 * read through `useSyncExternalStore`. Subscribing starts discovery and the `toolchange`
 * listener, and unmounting stops them. `fromOrigins` is compared by value, so inline arrays
 * are fine. Ids come from a page-wide table, so remounts and StrictMode never change them.
 */
import type { ReactNode } from "react";
import type {
  AnyToolDefinition,
  AnyToolImplementation,
  KnownTool,
  RegisterToolsOptions,
  ToolCallResult,
  ToolCatalogOptions,
  ToolCatalogSnapshot,
  ToolRegistrationSnapshot,
  UniqueToolNames,
} from "../index.js";
import { notImplemented } from "../not-implemented.js";

/**
 * Options for {@link useRegisterTools}. Changing `modelContext` or `exposedTo` (compared by
 * value) re-creates the registration. `enabled` and `onUnexpectedError` apply on the next commit.
 */
export interface UseRegisterToolsOptions extends Omit<RegisterToolsOptions, "signal"> {
  /** `false` unregisters every tool of this hook. Default `true`. */
  readonly enabled?: boolean;
}

/**
 * Registers tools while the component is mounted, and keeps them in sync with each render.
 *
 * @example
 * function Dashboard({ dashboard }: { dashboard: DashboardStore }) {
 *   const { tools } = useRegisterTools([applyFilterTool({ dashboard }), pingTool]);
 *   …
 * }
 */
export function useRegisterTools<const T extends readonly AnyToolImplementation[]>(
  tools: T & UniqueToolNames<T>,
  options?: UseRegisterToolsOptions,
): ToolRegistrationSnapshot {
  return notImplemented("useRegisterTools");
}

export type RegisterToolsProps<T extends readonly AnyToolImplementation[]> = UseRegisterToolsOptions & {
  readonly tools: T & UniqueToolNames<T>;
  /** Rendered as-is. The component adds no DOM. */
  readonly children?: ReactNode;
};

/**
 * Component form of {@link useRegisterTools}: tools are registered while it is mounted.
 *
 * @example
 * {cart.items.length > 0 && <RegisterTools tools={[checkoutTool({ cart })]} />}
 */
export function RegisterTools<const T extends readonly AnyToolImplementation[]>(props: RegisterToolsProps<T>): ReactNode {
  return notImplemented("RegisterTools");
}

/** What {@link useToolCatalog} returns: the current snapshot plus the catalog's call helpers. */
export interface UseToolCatalogResult extends ToolCatalogSnapshot {
  call(id: string, input?: unknown, options?: { readonly signal?: AbortSignal }): Promise<ToolCallResult>;
  find<D extends AnyToolDefinition>(definition: D): Promise<readonly KnownTool<D>[]>;
}

/**
 * Discovers the tools available to this page and re-renders when they change. EXPERIMENTAL.
 *
 * @example
 * const { status, tools } = useToolCatalog({ fromOrigins: ["https://widgets.example"] });
 */
export function useToolCatalog(options?: ToolCatalogOptions): UseToolCatalogResult {
  return notImplemented("useToolCatalog");
}
