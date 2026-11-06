/**
 * Every runtime entry point in this design prototype throws this error.
 * The prototype ships types and signatures only. Nothing in it is executable yet,
 * and nothing fakes success.
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
