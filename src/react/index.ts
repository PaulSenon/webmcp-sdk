/**
 * `webmcp-sdk/react`: optional React bindings. The core never imports React.
 *
 * ## Lifecycle contract (applies to every hook and component here)
 *
 * - **Register in an effect, never during render.** Nothing happens on the server.
 *   During SSR and the first client render, `status` is `"idle"`.
 * - **Unregister in the effect cleanup** by aborting that effect's signal. Unmount
 *   removes the tools, or cancels a registration that is still pending.
 * - **StrictMode-safe.** The dev-only mount → unmount → mount sequence produces
 *   register(A) → abort(A) → register(B). Registration is async in WebMCP, so B can start
 *   before A settles. Core queues SDK-issued registrations **per tool name per model
 *   context**: B's `registerTool` runs only after A has been rejected or removed. That
 *   way a remount never races into a spurious `duplicate_name`. Each effect owns its own
 *   `AbortController`, and cleanup only ever aborts its own.
 * - **What triggers re-registration:** a change in the identity of `toolset` (or
 *   `contract`), `enabled`, or `modelContext`. Re-registration is an unregister plus a
 *   register, and agents observe it as a tool change.
 * - **What never triggers re-registration:** `context`, `handler`, `onError`. They are
 *   stored in a ref and read when each call starts, so handlers always see the
 *   latest props and state (no stale closures) and there is no registration churn.
 * - **Ownership:** a registration belongs to the component that created it. Two mounted
 *   components registering the same tool name in one document is an error
 *   (`status: "error"`, `error.code === "duplicate_name"`). The first one wins and
 *   the second does not register. The SDK never silently replaces someone else's tool.
 * - **Errors never throw during render.** Registration errors go to `status`/`error`
 *   and to `onRegistrationError`.
 */
import type { ReactNode } from "react";
import type {
  AnyContract,
  AnyToolImplementation,
  ModelContextLike,
  RegisterOptions,
  ToolHandler,
  Toolset,
  ToolsetContext,
  WebMCPError,
} from "../index.js";
import { notImplemented } from "../not-implemented.js";

/** Registration status as seen from React. */
export type ToolRegistrationStatus =
  /** Not attempted yet (server render, first client render, or `enabled: false`). */
  | { readonly status: "idle"; readonly error?: undefined }
  | { readonly status: "registered"; readonly error?: undefined }
  /** No WebMCP in this browser. Expected in most browsers today, so it is not an error. */
  | { readonly status: "unsupported"; readonly error?: undefined }
  | { readonly status: "error"; readonly error: WebMCPError };

type SharedOptions = {
  /** Set to `false` to unregister (or not register). Default `true`. */
  readonly enabled?: boolean;
  /** Overrides `document.modelContext` (polyfill, tests). Changing it re-registers. */
  readonly modelContext?: ModelContextLike;
  /** Per-call error reporting, same as core `onError`. Latest value always used. */
  readonly onError?: RegisterOptions<{}>["onError"];
  /** Called when registration fails (duplicate name, schema conversion...). */
  readonly onRegistrationError?: (error: WebMCPError) => void;
};

/**
 * Options for `useToolset` / `<WebMCPTools>`. Unlike core `register()`, `context` is a
 * plain **value**. The hook keeps the latest one in a ref and core reads it on every call.
 */
export type UseToolsetOptions<TContext> = SharedOptions &
  ({} extends TContext ? { readonly context?: TContext } : { readonly context: TContext });

/**
 * Registers a toolset while the component is mounted.
 *
 * Keep `toolset` referentially stable: define it at module scope or memoize it.
 * A new toolset object on every render means re-registering on every render.
 *
 * @example
 * function CartPanel() {
 *   const cart = useCart();
 *   useToolset(cartTools, { context: { cart } }); // context updates never re-register
 *   return <CartView cart={cart} />;
 * }
 */
export function useToolset<TTools extends readonly AnyToolImplementation[]>(
  toolset: Toolset<TTools>,
  ...options: {} extends ToolsetContext<TTools>
    ? [options?: UseToolsetOptions<ToolsetContext<TTools>>]
    : [options: UseToolsetOptions<ToolsetContext<TTools>>]
): ToolRegistrationStatus {
  return notImplemented("useToolset");
}

/**
 * Registers one contract with a handler defined **inside** the component, so it can
 * read props and state directly. The latest handler runs on every call, and handler
 * identity changes never re-register.
 *
 * The contract must be stable (module scope). Re-registration is keyed on its identity.
 *
 * @example
 * function TodoList() {
 *   const [todos, setTodos] = useState<Todo[]>([]);
 *   useTool(addTodo, ({ input }) => {
 *     setTodos((t) => [...t, { id: crypto.randomUUID(), text: input.text }]);
 *     return { count: todos.length + 1 };
 *   });
 * }
 */
export function useTool<C extends AnyContract>(
  contract: C,
  handler: ToolHandler<C, {}>,
  options?: SharedOptions,
): ToolRegistrationStatus {
  return notImplemented("useTool");
}

/** Props for {@link WebMCPTools}. */
export type WebMCPToolsProps<TTools extends readonly AnyToolImplementation[]> = {
  readonly toolset: Toolset<TTools>;
  /** Rendered as-is. The component adds no DOM. */
  readonly children?: ReactNode;
} & UseToolsetOptions<ToolsetContext<TTools>>;

/**
 * Component form of {@link useToolset}: tools are registered while it is mounted.
 * Handy for conditional tool availability in JSX.
 *
 * @example
 * {cart.items.length > 0 && <WebMCPTools toolset={checkoutTools} context={{ cart }} />}
 */
export function WebMCPTools<TTools extends readonly AnyToolImplementation[]>(
  props: WebMCPToolsProps<TTools>,
): ReactNode {
  return notImplemented("WebMCPTools");
}
