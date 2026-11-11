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
import { notImplemented } from "../not-implemented.js";

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
  return notImplemented("useRegisterTools");
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
  return notImplemented("RegisterTools");
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
  return notImplemented("useToolCatalog");
}
