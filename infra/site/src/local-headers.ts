// local: WebMCP project headers (CSP, HSTS, COOP/CORP, Permissions-Policy, immutable /assets/*).
// The kit (v0.1.0–v0.1.3) renders only its own minimal headers and has no configuration hook for project
// headers; this file reads them from <repo>/delivery.headers (Cloudflare `_headers` format) and is
// imported by alchemy.run.ts (appended to the asset config) and by scripts/cli.ts smoke (checked
// on every smoke path). Upstream candidate: `site.headers` in delivery.config.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./config.ts";

export const HEADERS_FILE = "delivery.headers";
const KIT_OWNED = new Set(["x-content-type-options", "referrer-policy", "x-robots-tag", "x-delivery-revision"]);

/** The rules without comments; validated so nothing malformed reaches Cloudflare. */
export function parseProjectHeaders(text: string): { rules: string; global: Array<[string, string]> } {
  const out: string[] = [];
  const global: Array<[string, string]> = [];
  let pattern: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (line.length > 2000) throw new Error(`${HEADERS_FILE}: line over 2,000 characters`);
    if (!/^\s/.test(line)) {
      if (!line.startsWith("/")) throw new Error(`${HEADERS_FILE}: rule must start with a path: ${line.slice(0, 40)}`);
      pattern = line.trim();
      out.push(pattern);
      continue;
    }
    const m = /^\s+([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(line);
    if (!m || pattern === undefined) throw new Error(`${HEADERS_FILE}: malformed header line: ${line.trim().slice(0, 40)}`);
    const [, name, value] = m as unknown as [string, string, string];
    if (KIT_OWNED.has(name.toLowerCase())) throw new Error(`${HEADERS_FILE}: ${name} is set by the kit; do not repeat it`);
    out.push(`  ${name}: ${value}`);
    if (pattern === "/*") global.push([name, value]);
  }
  if (out.filter((l) => l.startsWith("/")).length > 90) throw new Error(`${HEADERS_FILE}: too many rules`);
  return { rules: out.length ? `${out.join("\n")}\n` : "", global };
}

export function projectHeaders(root = repoRoot) {
  const path = join(root, HEADERS_FILE);
  return existsSync(path) ? parseProjectHeaders(readFileSync(path, "utf8")) : { rules: "", global: [] };
}

/**
 * Merge the project rules into the kit's `_headers` text: headers of a pattern the kit already
 * has are appended inside the kit's block (Cloudflare's asset router rejects the whole file when
 * a pattern appears twice, verified under workerd); other patterns are appended as new rules.
 */
export function mergeHeaders(kit: string, project: string): string {
  const blocks = new Map<string, string[]>();
  const order: string[] = [];
  const add = (text: string) => {
    let current: string | undefined;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      if (!/^\s/.test(line)) {
        current = line.trim();
        if (!blocks.has(current)) {
          blocks.set(current, []);
          order.push(current);
        }
      } else if (current !== undefined) blocks.get(current)!.push(line);
    }
  };
  add(kit);
  add(project);
  return `${order.map((p) => [p, ...blocks.get(p)!].join("\n")).join("\n")}\n`;
}
