// Post-deploy smoke test. Checks that the deployed origin serves exactly the files that were
// uploaded, with the headers this package defines, and that unknown paths get the 404 page.
// Runs against Cloudflare after a deploy, and against `alchemy dev` (workerd) in PR checks.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { IMMUTABLE_CACHE_CONTROL, securityHeaders } from "./headers.ts";

export interface SmokeOptions {
  /** Origin to test, e.g. https://webmcp-sdk-docs.example.workers.dev/ */
  url: string;
  /** The directory that was deployed. index.html and 404.html are compared byte for byte. */
  siteDir: string;
  indexable: boolean;
  /** Expected X-Docs-Revision on non-production stages (`pr-6@abc1234`). */
  revision?: string;
  /** How long to wait for the new version to be served (propagation). */
  timeoutMs?: number;
  intervalMs?: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface SmokeResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
  checks: string[];
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function parseOrigin(url: string): URL {
  const u = new URL(url);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) {
    throw new Error(`smoke test URL must be https (or http on localhost): ${url}`);
  }
  if (u.username || u.password || u.search || u.hash) throw new Error(`unexpected URL parts: ${url}`);
  u.pathname = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  return u;
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const origin = parseOrigin(options.url);
  const doFetch = options.fetch ?? fetch;
  const log = options.log ?? (() => {});
  const failures: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];
  const expectedIndex = sha256(readFileSync(join(options.siteDir, "index.html")));
  const expected404 = sha256(readFileSync(join(options.siteDir, "404.html")));
  const get = (path: string) =>
    doFetch(new URL(path, origin), { redirect: "manual", headers: { "user-agent": "webmcp-sdk-docs-smoke" } });

  // 1. The new version is live: "/" returns the uploaded index.html, byte for byte.
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let home: Response | undefined;
  let last = "";
  for (;;) {
    try {
      const res = await get("./");
      const body = new Uint8Array(await res.arrayBuffer());
      if (res.status === 200 && sha256(body) === expectedIndex) {
        home = res;
        break;
      }
      last = `status ${res.status}, body sha256 ${sha256(body).slice(0, 12)} (want ${expectedIndex.slice(0, 12)})`;
    } catch (error) {
      last = String(error);
    }
    if (Date.now() >= deadline) break;
    log(`waiting for the new version: ${last}`);
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 5_000));
  }
  if (!home) {
    failures.push(`/ never served the deployed index.html: ${last}`);
    return { ok: false, failures, warnings, checks };
  }
  checks.push("/ → 200, body = deployed index.html");
  if (!home.headers.get("content-type")?.startsWith("text/html")) failures.push("/ is not served as text/html");
  checkHeaders("/", home.headers, options, failures, checks);

  // 2. Unknown paths: status 404 with the site's 404.html, and the same headers.
  const missingPath = `__smoke-missing-${Date.now().toString(36)}`;
  const missing = await get(missingPath);
  const missingBody = new Uint8Array(await missing.arrayBuffer());
  if (missing.status !== 404) failures.push(`/${missingPath} → ${missing.status}, want 404`);
  else if (sha256(missingBody) !== expected404) failures.push("404 response is not the deployed 404.html");
  else checks.push("unknown path → 404, body = deployed 404.html");
  // Cloudflare documents _headers for asset responses; whether it covers 404-page responses is
  // not documented (workerd does apply it). Report, don't fail.
  const missing404Failures: string[] = [];
  checkHeaders("404", missing.headers, options, missing404Failures, []);
  warnings.push(...missing404Failures);

  // 3. Routing config files are never served.
  for (const path of ["_headers", "_redirects"]) {
    const res = await get(path);
    await res.arrayBuffer();
    if (res.status === 200) failures.push(`/${path} is publicly served`);
  }
  checks.push("_headers and _redirects are not served");

  // 4. A content-hashed asset referenced by the home page is cached as immutable.
  const html = readFileSync(join(options.siteDir, "index.html"), "utf8");
  const asset = /["'](\/assets\/[^"'?#]+)["']/.exec(html)?.[1];
  if (!asset) {
    warnings.push("index.html references no /assets/ asset; immutable caching not checked");
  } else {
    const res = await get(`.${asset}`);
    await res.arrayBuffer();
    if (res.status !== 200) failures.push(`${asset} → ${res.status}, want 200`);
    else if (res.headers.get("cache-control") !== IMMUTABLE_CACHE_CONTROL) {
      failures.push(`${asset} cache-control is ${JSON.stringify(res.headers.get("cache-control"))}`);
    } else checks.push(`${asset} → 200, immutable`);
  }

  // 5. Clean URLs (html_handling "drop-trailing-slash"): a prerendered page directory is served
  //    without a trailing slash and the slashed form redirects to it. The site's links, canonical
  //    URLs and sitemap never end with a slash, so the other modes would redirect every one of them.
  const page = firstPageDir(options.siteDir);
  if (!page) {
    warnings.push("the site has no <dir>/index.html page; trailing-slash handling not checked");
  } else {
    const clean = await get(page);
    await clean.arrayBuffer();
    const slashed = await get(`${page}/`);
    await slashed.arrayBuffer();
    const location = slashed.headers.get("location");
    const target = location ? new URL(location, new URL(`${page}/`, origin)).pathname : undefined;
    const before = failures.length;
    if (clean.status !== 200) failures.push(`/${page} → ${clean.status}, want 200 (html_handling drop-trailing-slash)`);
    if (slashed.status < 300 || slashed.status > 399 || target !== new URL(page, origin).pathname) {
      failures.push(`/${page}/ → ${slashed.status} ${location ?? ""}, want a redirect to /${page}`);
    }
    if (failures.length === before) checks.push(`/${page} → 200, /${page}/ → redirect to /${page}`);
  }

  return { ok: failures.length === 0, failures, warnings, checks };
}

/** First top-level directory of the site with an index.html (a prerendered page), if any. */
function firstPageDir(siteDir: string): string | undefined {
  return readdirSync(siteDir)
    .sort()
    .find((name) => {
      const index = join(siteDir, name, "index.html");
      return statSync(join(siteDir, name)).isDirectory() && existsSync(index) && statSync(index).isFile();
    });
}

function checkHeaders(
  where: string,
  headers: Headers,
  { indexable, revision }: { indexable: boolean; revision?: string },
  failures: string[],
  checks: string[],
) {
  const before = failures.length;
  for (const [name, value] of securityHeaders({ indexable, ...(revision ? { revision } : {}) })) {
    const actual = headers.get(name);
    if (actual !== value) failures.push(`${where}: ${name} is ${JSON.stringify(actual)}, want ${JSON.stringify(value)}`);
  }
  if (indexable && headers.get("x-robots-tag")) failures.push(`${where}: production must not send X-Robots-Tag`);
  if (failures.length === before) checks.push(`${where}: security headers as defined in src/headers.ts`);
}
