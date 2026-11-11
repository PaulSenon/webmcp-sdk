/**
 * Retained for compatibility with the design prototype.
 * The implemented core and React entry points no longer throw this error.
 */
export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError";
  constructor(readonly api: string) {
    super(`webmcp-sdk: \`${api}\` is not implemented (design prototype, types only).`);
  }
}
