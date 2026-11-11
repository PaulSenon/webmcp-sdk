/** @internal Pure name allocation, scoped to one catalog. */
export function createNameIssuer({ prefix, maxNameLength }: { prefix: string; maxNameLength: number }) {
  const issued = new Set<string>();
  return { has: (name: string) => issued.has(name), issue(source: string, toolName: string) {
    const head = `${prefix}${source}__`;
    const normalized = toolName.replace(/[^A-Za-z0-9_-]/g, "_");
    let suffix = "", n = 1, name: string;
    do {
      if (head.length + suffix.length >= maxNameLength) throw new RangeError("maxNameLength cannot fit a source and tool name.");
      name = head + normalized.slice(0, maxNameLength - head.length - suffix.length) + suffix;
      suffix = `_${++n}`;
    } while (issued.has(name));
    issued.add(name); return name;
  } };
}
