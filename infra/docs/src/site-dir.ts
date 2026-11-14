// Validation of the static site directory before it is uploaded. In CI the directory is a build
// artifact produced by a job that ran untrusted code (the site build), so it is treated as data:
// no symlinks (Alchemy uploads a symlink's target, which could publish runner files), only regular
// files, within Cloudflare's limits, with the pages the routing config relies on.
import { lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Workers static assets limits (Free plan): https://developers.cloudflare.com/workers/platform/limits/#static-assets
export const MAX_FILES = 20_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const REQUIRED = ["index.html", "404.html"];
// Never publish credentials or VCS data, whatever the build produced.
const FORBIDDEN = [/^\.env(\..*)?$/, /^\.npmrc$/, /^\.git$/, /^\.alchemy$/, /^id_[a-z0-9]+$/, /\.pem$/];
// Read by Cloudflare as routing config, not served. This package sets both explicitly, so a copy
// in the build output has no effect; it is reported so nobody relies on it.
const IGNORED_CONFIG = ["_headers", "_redirects", ".assetsignore", "_routes.json", "_worker.js"];

export interface SiteReport {
  files: number;
  bytes: number;
  warnings: string[];
}

export class SiteDirError extends Error {}

export function checkSiteDir(root: string): SiteReport {
  const top = lstatSafe(root);
  if (!top?.isDirectory()) throw new SiteDirError(`site directory not found: ${root}`);
  let files = 0;
  let bytes = 0;
  const warnings: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(root, path).split(sep).join("/");
      // Names end up in CI logs: control characters could forge workflow commands.
      if (/[\u0000-\u001f\u007f]/.test(name)) throw new SiteDirError(`control character in file name ${JSON.stringify(rel)}`);
      if (FORBIDDEN.some((re) => re.test(name))) throw new SiteDirError(`refusing to publish ${JSON.stringify(rel)}`);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) throw new SiteDirError(`symlink in site output: ${JSON.stringify(rel)}`);
      if (st.isDirectory()) {
        walk(path);
        continue;
      }
      if (!st.isFile()) throw new SiteDirError(`not a regular file: ${JSON.stringify(rel)}`);
      if (st.size > MAX_FILE_BYTES) throw new SiteDirError(`${JSON.stringify(rel)} is over 25 MiB (Cloudflare limit)`);
      if (dir === root && IGNORED_CONFIG.includes(name)) {
        warnings.push(`${rel} in the build output is ignored (headers/redirects are set by infra/docs)`);
      }
      files += 1;
      bytes += st.size;
      if (files > MAX_FILES) throw new SiteDirError(`more than ${MAX_FILES} files (Cloudflare Free limit)`);
    }
  };
  walk(root);
  for (const name of REQUIRED) {
    if (!lstatSafe(join(root, name))?.isFile()) throw new SiteDirError(`missing ${name} at the site root`);
  }
  return { files, bytes, warnings };
}

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}
