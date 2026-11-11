/**
 * The deferred React runtime entry points throw this error.
 * The framework-independent core is implemented; React bindings remain typed stubs.
 */
export class NotImplementedError extends Error {
  override readonly name = "NotImplementedError";
  constructor(readonly api: string) {
    super(`webmcp-sdk: \`${api}\` is not implemented (design prototype, types only).`);
  }
}

/** @internal */
export function notImplemented(api: string): never {
  throw new NotImplementedError(api);
}
