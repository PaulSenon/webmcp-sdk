/**
 * `webmcp-sdk/react`: optional React bindings. The core never imports React.
 *
 * ## Lifecycle contract (applies to every hook and component here)
 *
 * - **Register in an effect, never during render.** Nothing happens on the server.
 *   During SSR and the first client render, `state` is `"idle"`.
 * - **Unregister in the effect cleanup** by aborting that effect's own `AbortController`.
 *   Unmount removes the tools, or cancels a registration that is still pending.
 * - **StrictMode-safe.** The dev-only mount → unmount → mount sequence produces
 *   register(A) → abort(A) → register(B). Registration is async in WebMCP, so B can start
 *   before A settles. Core queues SDK-issued registrations **per tool name per model
 *   context**: B's `registerTool` runs only after A has been rejected or removed. That
 *   way a remount never races into a spurious `duplicate_name`.
 * - **What triggers re-registration:** a change in the **list of tool implementations**
 *   (element identity, compared shallowly, so a new `toolset([...])` wrapper around the
 *   same tools does not re-register), or a change in `contract` (for `useTool`), `enabled`,
 *   `modelContext`, `exposedTo` (compared by value), `ifUnsupported` or `jsonSchemaTarget`.
 *   Re-registration is an unregister plus a register, and agents observe it as a tool change.
 * - **What never triggers re-registration:** `context`, `handler`, `onToolError`,
 *   `onRegistrationError`. They are stored in a ref and read when each call starts, so
 *   handlers see the latest props and state (no stale closures) and there is no
 *   registration churn.
 * - **Churn warning (dev only):** re-registering on several consecutive renders logs a
 *   `console.warn`. It usually means a contract or tool was created inline during render.
 * - **`<Activity mode="hidden">`:** React unmounts the effects of hidden subtrees, so their
 *   tools are unregistered while hidden and registered again when visible.
 * - **Ownership:** a registration belongs to the component that created it. If a name is
 *   already registered in the document, by another component or by non-SDK code, the
 *   hook reports `state: "error"`, `error.code === "duplicate_name"`. It never replaces
 *   the other tool. It **retries automatically** when the conflicting SDK registration
 *   ends, or on the next `toolchange` event for registrations it does not own. That way
 *   overlapping route transitions settle by themselves.
 * - **Errors never throw during render.** Registration errors go to `state`/`error` and
 *   to `onRegistrationError`.
 *
 * `context` is a plain **value** here (core's `register()` takes a getter). The hook keeps
 * the latest value in a ref and hands core a getter that reads it.
 */
import type { ReactNode } from "react";
import type {
  AnyContract,
  AnyToolImplementation,
  JSONSchemaTarget,
  ModelContextLike,
  RegisterOptions,
  ToolHandler,
  Toolset,
  ToolsetContext,
  WebMCPError,
} from "../index.js";
import { notImplemented } from "../not-implemented.js";

/** Registration state as seen from React. It extends core's `RegistrationState`. */
export type ToolRegistrationStatus =
  /** Not attempted: server render, first client render, or `enabled: false`. */
  | { readonly state: "idle"; readonly error?: undefined }
  /** `registerTool` calls are in flight (or queued behind a previous registration of the same name). */
  | { readonly state: "pending"; readonly error?: undefined }
  | { readonly state: "registered"; readonly error?: undefined }
  /** No WebMCP in this browser. Expected in most browsers today, so it is not an error. */
  | { readonly state: "unsupported"; readonly error?: undefined }
  /** Registration failed. `duplicate_name` is retried automatically (see lifecycle). */
  | { readonly state: "error"; readonly error: WebMCPError };

/** Options shared by every hook and component. */
export type SharedOptions = {
  /** Set to `false` to unregister (or not register). Default `true`. */
  readonly enabled?: boolean;
  /** Overrides `document.modelContext` (polyfill, tests). */
  readonly modelContext?: ModelContextLike;
  /** Same as core. Default `"skip"`. */
  readonly ifUnsupported?: "throw" | "skip";
  /** Same as core: origins allowed to discover these tools from other frames. */
  readonly exposedTo?: readonly string[];
  readonly jsonSchemaTarget?: JSONSchemaTarget;
  /** Per-call error reporting, same as core. Latest value always used. */
  readonly onToolError?: RegisterOptions<{}>["onToolError"];
  /** Called when registration fails (duplicate name, schema conversion...). */
  readonly onRegistrationError?: (error: WebMCPError) => void;
};

/** Options for `useToolset` / `<RegisterToolset>`. */
export type UseToolsetOptions<TContext> = SharedOptions &
  ({} extends TContext ? { readonly context?: TContext } : { readonly context: TContext });

/**
 * Registers a toolset while the component is mounted.
 *
 * @example
 * function CartPanel() {
 *   const cart = useCart();
 *   const { state } = useToolset(cartTools, { context: { cart } }); // context updates never re-register
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

/** Props for {@link RegisterToolset}. */
export type RegisterToolsetProps<TTools extends readonly AnyToolImplementation[]> = {
  readonly toolset: Toolset<TTools>;
  /** Rendered as-is. The component adds no DOM. */
  readonly children?: ReactNode;
} & UseToolsetOptions<ToolsetContext<TTools>>;

/**
 * Component form of {@link useToolset}: tools are registered while it is mounted (and
 * visible, see `<Activity>`). Handy for conditional availability in JSX.
 *
 * @example
 * {cart.items.length > 0 && <RegisterToolset toolset={checkoutTools} context={{ cart }} />}
 */
export function RegisterToolset<TTools extends readonly AnyToolImplementation[]>(
  props: RegisterToolsetProps<TTools>,
): ReactNode {
  return notImplemented("RegisterToolset");
}
