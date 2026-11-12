import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { IMMUTABLE_CACHE_CONTROL, securityHeaders } from "../src/headers.ts";
import { parseOrigin, runSmoke } from "../src/smoke.ts";

let root: string;
before(() => {
  root = mkdtempSync(join(tmpdir(), "docs-smoke-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), '<script type="module" src="/assets/entry.client-1a2b.js"></script>home');
  writeFileSync(join(root, "404.html"), "not found page");
  mkdirSync(join(root, "guide"));
  writeFileSync(join(root, "guide/index.html"), "guide");
  writeFileSync(join(root, "assets/entry.client-1a2b.js"), "1");
});
after(() => rmSync(root, { recursive: true, force: true }));

interface Behaviour {
  indexable: boolean;
  staleFor?: number; // serve an old index.html for this many requests
  dropHeader?: string;
  softNotFound?: boolean; // 200 instead of 404
  mutableAssets?: boolean;
  autoTrailingSlash?: boolean; // html_handling "auto-trailing-slash": /guide redirects to /guide/
}

async function serve(b: Behaviour): Promise<{ url: string; server: Server }> {
  let stale = b.staleFor ?? 0;
  const server = createServer((req, res) => {
    const headers = Object.fromEntries(securityHeaders({ indexable: b.indexable }).filter(([n]) => n !== b.dropHeader));
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/") {
      const body = stale-- > 0 ? "old" : readFileSync(join(root, "index.html"));
      res.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" }).end(body);
    } else if (path === "/guide" || path === "/guide/") {
      const canonical = b.autoTrailingSlash ? "/guide/" : "/guide";
      if (path === canonical) res.writeHead(200, { ...headers, "content-type": "text/html" }).end("guide");
      else res.writeHead(307, { ...headers, location: canonical }).end();
    } else if (path.startsWith("/assets/")) {
      res.writeHead(200, { ...headers, "cache-control": b.mutableAssets ? "public, max-age=0" : IMMUTABLE_CACHE_CONTROL }).end("1");
    } else {
      res.writeHead(b.softNotFound ? 200 : 404, { ...headers, "content-type": "text/html" }).end(readFileSync(join(root, "404.html")));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, server };
}

async function smoke(b: Behaviour, indexable = b.indexable) {
  const { url, server } = await serve(b);
  try {
    return await runSmoke({ url, siteDir: root, indexable, timeoutMs: 2_000, intervalMs: 50 });
  } finally {
    server.close();
  }
}

test("passes against a correct deployment", async () => {
  const r = await smoke({ indexable: true });
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.ok);
});

test("waits for propagation of the new version", async () => {
  const r = await smoke({ indexable: false, staleFor: 3 });
  assert.ok(r.ok, r.failures.join("\n"));
});

test("fails when the old version never goes away", async () => {
  const r = await smoke({ indexable: false, staleFor: 10_000 });
  assert.equal(r.ok, false);
  assert.match(r.failures[0] ?? "", /never served the deployed index.html/);
});

test("fails on a missing security header", async () => {
  const r = await smoke({ indexable: true, dropHeader: "Content-Security-Policy" });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.startsWith("/: Content-Security-Policy")));
});

test("fails when production sends noindex, or a preview does not", async () => {
  assert.equal((await smoke({ indexable: false }, true)).ok, false);
  assert.equal((await smoke({ indexable: true }, false)).ok, false);
});

test("fails on soft 404 and on mutable hashed assets", async () => {
  assert.ok((await smoke({ indexable: true, softNotFound: true })).failures.some((f) => /want 404/.test(f)));
  assert.ok((await smoke({ indexable: true, mutableAssets: true })).failures.some((f) => /cache-control/.test(f)));
});

test("fails when pages need a trailing slash (links and canonical URLs have none)", async () => {
  const r = await smoke({ indexable: true, autoTrailingSlash: true });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.startsWith("/guide → 307")));
  assert.ok(r.failures.some((f) => f.startsWith("/guide/ → 200")));
});

test("URL validation", () => {
  assert.equal(parseOrigin("https://a.workers.dev").href, "https://a.workers.dev/");
  assert.equal(parseOrigin("http://localhost:1337").href, "http://localhost:1337/");
  assert.throws(() => parseOrigin("http://a.workers.dev/"), /https/);
  assert.throws(() => parseOrigin("https://u:p@a.workers.dev/"), /unexpected/);
  assert.throws(() => parseOrigin("file:///etc/passwd"), /https/);
});
