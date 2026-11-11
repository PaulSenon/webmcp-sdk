/** @internal */
export const errorName = (error: unknown): string => error && typeof error === "object" && "name" in error ? String(error.name) : "Error";
/** @internal */
export const normalizeOrigins = (origins?: readonly string[]): string[] => [...new Set(origins ?? [])].sort();
