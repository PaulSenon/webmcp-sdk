/**
 * Errors come in two audiences, and the SDK keeps them apart:
 *
 * 1. **Agent-facing** ({@link ToolFailure}): what an agent sees when a tool call fails.
 *    Short, actionable, and free of internals. Stacks, `cause` chains and unknown
 *    error messages are never sent.
 * 2. **Developer-facing** ({@link WebMCPError}): thrown into your code when a definition
 *    or registration is wrong. These never reach an agent.
 */

/**
 * Where a tool call failed. Each kind tells the agent what to do next:
 *
 * | kind               | meaning                                              | agent should              |
 * | ------------------ | ---------------------------------------------------- | ------------------------- |
 * | `input_invalid`    | arguments failed the input schema                    | fix arguments using `issues`, retry |
 * | `execution_failed` | the handler threw                                    | read `message`/`code`; retry only if `retryable` |
 * | `output_invalid`   | the handler returned data that failed the output schema | not retry: page bug    |
 * | `cancelled`        | the browser aborted the call (agent cancel, page unload) and the handler stopped | not retry unless asked |
 * | `unavailable`      | this registration ended (unregister, abort, React unmount) before or during the call, and the handler did not complete | re-discover tools |
 *
 * A failing `context()` resolver is `execution_failed` with `code: "context_unavailable"`.
 * In practice, a caller whose own signal aborted has already been rejected by the browser
 * and never sees `cancelled`. The kind exists for every other path.
 */
export type ToolFailureKind =
  | "input_invalid"
  | "execution_failed"
  | "output_invalid"
  | "cancelled"
  | "unavailable";

/** One validation problem, flattened from Standard Schema issues. */
export interface ToolIssue {
  /** JSON Pointer into the arguments, e.g. `"/items/0/quantity"`. `""` is the root. */
  readonly path: string;
  readonly message: string;
}

/** The structured, serializable failure an agent receives. */
export type ToolFailure =
  | {
      readonly kind: "input_invalid";
      readonly message: string;
      readonly issues: readonly ToolIssue[];
    }
  | {
      readonly kind: "execution_failed";
      /** The `ToolError` message, or a generic message for unexpected errors. */
      readonly message: string;
      /** The `ToolError` code. `"internal"` for unexpected errors, `"context_unavailable"` when `context()` failed. */
      readonly code: string;
      readonly retryable: boolean;
      /** Extra JSON data from `ToolError`, if any. */
      readonly data?: unknown;
    }
  | { readonly kind: "output_invalid"; readonly message: string }
  | { readonly kind: "cancelled"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

/**
 * The JSON value returned to the browser when a call fails.
 *
 * Why in-band rather than a rejected promise: in the WebMCP draft, a rejected `execute`
 * callback reaches the caller as an opaque `OperationError` whose message is **not**
 * forwarded, so the agent would learn nothing actionable. A returned value is
 * serialized and delivered as-is.
 *
 * So that strict agents do not drop it as malformed, a tool with an `output` schema
 * advertises `outputSchema: { anyOf: [<output>, <ToolFailureEnvelope schema>] }`. A tool
 * without one advertises no `outputSchema`. See README "Open questions" #1.
 */
export interface ToolFailureEnvelope {
  /** Discriminator. Consumers must check `isError === true` **and** a known `error.kind`. */
  readonly isError: true;
  readonly error: ToolFailure;
}

export interface ToolErrorOptions {
  /** Stable machine-readable code, e.g. `"OUT_OF_STOCK"`. Defaults to `"tool_error"`. */
  readonly code?: string;
  /** Whether calling again with the same arguments may succeed. Defaults to `false`. */
  readonly retryable?: boolean;
  /** Extra JSON-serializable data for the agent. */
  readonly data?: unknown;
  /** Kept locally for logging (`onToolError`). **Never** sent to the agent. */
  readonly cause?: unknown;
}

/**
 * Throw this from a handler to send an agent-readable failure.
 *
 * Only `ToolError` messages reach the agent. Any other thrown value becomes
 * `{ kind: "execution_failed", code: "internal", message: "The tool failed unexpectedly." }`,
 * and the original goes to the `onToolError` callback you passed at registration.
 *
 * @example
 * throw new ToolError("Only 2 left in stock. Retry with quantity <= 2.", {
 *   code: "OUT_OF_STOCK",
 *   data: { available: 2 },
 * });
 */
export class ToolError extends Error {
  override readonly name = "ToolError";
  readonly code: string;
  readonly retryable: boolean;
  readonly data: unknown;

  constructor(message: string, options: ToolErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = options.code ?? "tool_error";
    this.retryable = options.retryable ?? false;
    this.data = options.data;
  }
}

/** Developer-facing error codes. These are bugs or environment problems, not agent mistakes. */
export type WebMCPErrorCode =
  /** No WebMCP implementation (`document.modelContext`) in this environment (SSR, insecure context, unsupported browser). */
  | "unsupported"
  /** A tool with this name is already registered in this document, by you or someone else (browser `InvalidStateError`). */
  | "duplicate_name"
  /** A schema could not be converted to JSON Schema (see `cause`). */
  | "json_schema_unavailable"
  /** Malformed definition: empty description, invalid name, non-object input schema... */
  | "invalid_definition"
  /** The browser rejected the registration for another reason, e.g. `NotAllowedError` from the `tools` permissions policy (see `cause`). */
  | "registration_failed";

/** Thrown into developer code. Never serialized to agents. */
export class WebMCPError extends Error {
  override readonly name = "WebMCPError";
  constructor(
    readonly code: WebMCPErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly toolName?: string },
  ) {
    super(message, { cause: options?.cause });
    this.toolName = options?.toolName;
  }
  readonly toolName: string | undefined;
}
