// The site artifact is produced by UNTRUSTED code (the PR's build, in CI without secrets) and
// consumed by the privileged deploy job. It is treated as data only: never executed, sourced,
// installed or extracted into the workspace. This check bounds what can be uploaded.
//
// The deploy downloads it as a ZIP through the API and extracts it with unzip.ts (zip-slip,
// symlinks, special files, encryption, ZIP64, sizes, CRC), then this check runs on the result.
//
// Layout (site.artifact):
//   assets/**            static files served by Cloudflare's asset layer
//   server/<entry>       only when site.server: a prebuilt ESM Worker (+ sibling modules),
//                        uploaded byte-for-byte (Alchemy Worker `bundle: false`)
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, sep } from "node:path";

export interface ArtifactLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

// Cloudflare Workers static assets: 25 MiB per file; file count limits depend on the plan.
export const DEFAULT_LIMITS: ArtifactLimits = { maxFiles: 20_000, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 500 * 1024 * 1024 };

// Bundlers emit route chunks such as "(docs)-K0Micpkv.js" or "[slug]-x.js": allowed. Never
// spaces, quotes, backslashes, control characters or path separators (the deploy passes paths to
// tools, never to a shell, but humans read them in logs).
const SAFE_SEGMENT = /^[A-Za-z0-9._@+~()[\]$,=-]+$/;
const ALLOWED_DOTFILES = new Set([".well-known"]);

/** Written by the build job; never trusted, only compared with what the deploy recomputed (deploy-plan.ts checkManifest). */
export const MANIFEST = "manifest.json";
export interface ArtifactReport {
  files: number;
  bytes: number;
  hasServer: boolean;
  /** Approximate gzip size of server/ (Workers Free plan limit: 3 MiB compressed, Paid: 10 MiB). */
  serverGzipBytes: number;
  warnings: string[];
}

export const FREE_PLAN_WORKER_GZIP = 3 * 1024 * 1024;

function walk(dir: string, root: string, onFile: (path: string, size: number) => void) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path);
    if (!SAFE_SEGMENT.test(name)) throw new Error(`unsafe file name: ${JSON.stringify(rel)}`);
    if (name.startsWith(".") && !ALLOWED_DOTFILES.has(name)) throw new Error(`hidden file in artifact: ${rel}`);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error(`symlink in artifact: ${rel}`);
    if (st.isDirectory()) walk(path, root, onFile);
    else if (st.isFile()) onFile(rel.split(sep).join("/"), st.size);
    else throw new Error(`not a regular file: ${rel}`);
  }
}

export function checkArtifact(dir: string, opts: { server: boolean; serverEntry?: string; limits?: ArtifactLimits }): ArtifactReport {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const top = readdirSync(dir);
  const allowedTop = opts.server ? ["assets", "server", MANIFEST] : ["assets", MANIFEST];
  for (const name of top) if (!allowedTop.includes(name)) throw new Error(`unexpected top-level entry ${JSON.stringify(name)} (allowed: ${allowedTop.join(", ")})`);
  if (!top.includes("assets")) throw new Error("artifact has no assets/ directory");
  if (opts.server && !top.includes("server")) throw new Error("site.server is true but the artifact has no server/ directory");
  let files = 0;
  let bytes = 0;
  const seen: string[] = [];
  walk(dir, dir, (rel, size) => {
    files++;
    bytes += size;
    seen.push(rel);
    if (size > limits.maxFileBytes) throw new Error(`${rel} is larger than ${limits.maxFileBytes} bytes`);
    if (files > limits.maxFiles) throw new Error(`more than ${limits.maxFiles} files`);
    if (bytes > limits.maxTotalBytes) throw new Error(`more than ${limits.maxTotalBytes} bytes`);
  });
  if (!seen.includes("assets/index.html")) throw new Error("assets/index.html is missing");
  const entry = `server/${opts.serverEntry ?? "index.js"}`;
  if (opts.server && !seen.includes(entry)) throw new Error(`${entry} is missing`);
  // Source maps would be uploaded as Worker modules and carry build-machine paths: not shipped.
  const maps = seen.filter((f) => f.startsWith("server/") && f.endsWith(".map"));
  if (maps.length) throw new Error(`source maps in server/ (${maps[0]}…): drop them from the deploy layout`);
  const serverGzipBytes = seen.filter((f) => f.startsWith("server/")).reduce((n, f) => n + gzipSync(readFileSync(join(dir, f))).length, 0);
  const warnings = serverGzipBytes > FREE_PLAN_WORKER_GZIP ? [`server/ is ~${(serverGzipBytes / 1024 / 1024).toFixed(1)} MiB gzipped: above the Workers Free plan limit (3 MiB)`] : [];
  return { files, bytes, hasServer: opts.server, serverGzipBytes, warnings };
}
