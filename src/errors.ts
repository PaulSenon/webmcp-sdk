
import type { JsonValue } from "./schema.js";

/*
 * Two audiences, kept apart:
 * - Agent-facing: a failed call returns a ToolFailureEnvelope. It is short and actionable,
 *   and never contains stacks, causes or unexpected error messages.
 * - Developer-facing: WebMCPError for definition and registration problems. It never
 *   reaches an agent.
 */

/** One input-validation problem, flattened from Standard Schema issues. */
export interface ToolIssue {
  /** Readable path into the arguments, e.g. `"items[0].sku"`, or `"(root)"` when the issue has none. */
  readonly path: string;
  /** The schema library's message, passed through. */
  readonly message: string;
}

/**
 * Why a call failed, as the agent sees it. `handlerCalled` is a fact the SDK knows exactly.
 * It is **not** a promise about side effects.
 *
 * | kind             | handlerCalled | meaning |
 * | ---------------- | ------------- | ------- |
 * | `input_invalid`  | `false`       | arguments failed the input schema; the tool did not run |
 * | `tool_error`     | `true`        | the handler threw a `ToolError`: the author's message, code, data |
 * | `internal`       | `true`/`false`| an unexpected error (a defect, or a validator that crashed); no details |
 * | `output_invalid` | `true`        | the tool ran, but its result failed the declared output schema and was withheld |
 */
export type ToolFailure =
  | {
      readonly kind: "input_invalid";
      readonly handlerCalled: false;
      readonly message: string;
      readonly issues: readonly ToolIssue[];
      /** How many issues were left out (at most 20 are sent). */
      readonly omittedIssues?: number;
    }
  | {
      readonly kind: "tool_error";
      readonly handlerCalled: true;
      readonly message: string;
      readonly code?: string;
      readonly data?: JsonValue;
    }
  | { readonly kind: "internal"; readonly handlerCalled: boolean; readonly message: string }
  | { readonly kind: "output_invalid"; readonly handlerCalled: true; readonly message: string };

/** The kinds above, as a type. */
export type ToolFailureKind = ToolFailure["kind"];

/**
 * The JSON value a failed call returns to the browser (in-band).
 *
 * In-band, because in WebMCP a rejected `execute` reaches the caller as an opaque
 * `OperationError` and the message is dropped. When the tool declares an `output`
 * schema, the advertised `outputSchema` is `anyOf: [<output>, <this envelope>]`, so strict
 * agents do not discard failures as malformed results. Successful results are sent
 * as-is, never wrapped.
 */
export interface ToolFailureEnvelope {
  readonly isError: true;
  readonly error: ToolFailure;
}

/**
 * `true` if `value` is a failure envelope: `isError === true`, and `error` carries a known
 * `kind` and a string `message`. A successful result that happens to have exactly this
 * shape is indistinguishable on the wire (see the README's limitations).
 */
export function isToolFailureEnvelope(value: unknown): value is ToolFailureEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as ToolFailureEnvelope;
  return v.isError === true && !!v.error && typeof v.error.message === "string" &&
    ["input_invalid", "tool_error", "internal", "output_invalid"].includes(v.error.kind);
}

export interface ToolErrorOptions {
  /** Stable machine-readable code, e.g. `"OUT_OF_STOCK"`. Omitted from the response when absent. */
  readonly code?: string;
  /** Structured facts for the agent. Dropped (and reported to `onUnexpectedError`) if it cannot be serialized. */
  readonly data?: JsonValue;
  /** For your logs only (`onUnexpectedError`). Never sent. */
  readonly cause?: unknown;
}

/**
 * Throw this (or a subclass) from a handler to tell the agent why the call failed.
 *
 * Only `message`, `code` and `data` are sent. `name`, `stack`, `cause` and any other
 * property, including subclass fields, are not. Anything you write into `message` or
 * `data` is sent as-is: do not forward third-party error messages blindly.
 *
 * Any other thrown value is a defect. The agent gets `{ kind: "internal" }` with a generic
 * message, and the original goes to `onUnexpectedError`.
 *
 * @example
 * throw new ToolError(`Only ${left} left. Ask for at most ${left}.`, { code: "OUT_OF_STOCK", data: { left } });
 */
export class ToolError extends Error {
  override name = "ToolError";
  readonly code: string | undefined;
  readonly data: JsonValue | undefined;

  constructor(message: string, options: ToolErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.data = options.data;
  }
}

/**
 * Recognizes a `ToolError` (or a subclass) by a brand (`Symbol.for("webmcp-sdk.tool-error")`),
 * so it also works when two copies of this package are bundled, where `instanceof` fails.
 */
export function isToolError(value: unknown): value is ToolError {
  return !!value && (typeof value === "object" || typeof value === "function") &&
    (value as Record<symbol, unknown>)[Symbol.for("webmcp-sdk.tool-error")] === true;
}

/** Developer-facing error codes. Bugs or environment problems, never agent mistakes. */
export type WebMCPErrorCode =
  /** Thrown by `defineTool`: invalid name or empty description. */
  | "invalid_definition"
  /** Registration: the name is already registered in this document (browser `InvalidStateError`). */
  | "duplicate_name"
  /** Registration: a schema could not be converted to JSON Schema, or the input's JSON Schema root is not an object (see `cause`). */
  | "json_schema_unavailable"
  /** Registration: the browser rejected the tool for another reason, e.g. `NotAllowedError` from the permissions policy (see `cause`). */
  | "registration_failed";

/**
 * Developer-facing error.
 * - **Thrown** by `defineTool` (`invalid_definition`).
 * - **Rejects** `registerTool` (`duplicate_name`, `json_schema_unavailable`, `registration_failed`).
 * - **Reported** per tool by `registerTools` and the React hooks.
 *
 * It never reaches an agent. A missing WebMCP is not an error: it is reported as `"unsupported"`.
 */
export class WebMCPError extends Error {
  override name = "WebMCPError";
  readonly toolName: string | undefined;

  constructor(
    readonly code: WebMCPErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly toolName?: string },
  ) {
    super(message, { cause: options?.cause });
    this.toolName = options?.toolName;
  }
}

Object.defineProperty(ToolError.prototype, Symbol.for("webmcp-sdk.tool-error"), { value: true });
