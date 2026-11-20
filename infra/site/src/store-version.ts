// The state-API version the deployed Cloudflare state store must serve (preflight, v0.3.5).
//
// The kit's stores are Alchemy's CLOUDFLARE state store (bootstrapped by `alchemy state bootstrap`
// with @alchemy.run/cloudflare), whose version is `STATE_STORE_VERSION` in
// @alchemy.run/cloudflare/lib/StateStore/Api.js (8 in 2.0.0-beta.85) — NOT `alchemy/State`'s
// STATE_STORE_VERSION (5: the generic HTTP contract), which the kit wrongly compared against until
// v0.3.4 (first real CI production deploy: "serves state API v8, this Alchemy expects v5").
// The constant is not exported by the package, so it is read from the installed file, strictly,
// and the preflight refuses when it cannot be determined (fail closed).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const DECL = /^export const STATE_STORE_VERSION = (\d+);$/gm;

/** Exactly one `export const STATE_STORE_VERSION = <n>;` line, else an error. */
export function parseStoreVersion(source: string, label = "Api.js"): number {
  const found = [...source.matchAll(DECL)].map((m) => Number(m[1]));
  if (found.length !== 1 || !Number.isSafeInteger(found[0]) || found[0]! < 1) {
    throw new Error(`${label}: expected exactly one \`export const STATE_STORE_VERSION = <n>;\`, found ${found.length}`);
  }
  return found[0]!;
}

/** The Cloudflare state store version of the INSTALLED @alchemy.run/cloudflare. */
export function installedStoreVersion(from: string = import.meta.url): { version: number; packageVersion: string } {
  let dir: string;
  let packageVersion = "unknown";
  try {
    const pkgJson = createRequire(from).resolve("@alchemy.run/cloudflare/package.json");
    dir = dirname(pkgJson);
    packageVersion = (JSON.parse(readFileSync(pkgJson, "utf8")) as { version?: string }).version ?? "unknown";
    return { version: parseStoreVersion(readFileSync(join(dir, "lib/StateStore/Api.js"), "utf8"), "@alchemy.run/cloudflare lib/StateStore/Api.js"), packageVersion };
  } catch (error) {
    throw new Error(`cannot determine the Cloudflare state store version of @alchemy.run/cloudflare ${packageVersion}; refusing (${(error as Error).message})`);
  }
}
