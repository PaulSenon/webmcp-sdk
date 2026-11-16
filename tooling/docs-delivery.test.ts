// WebMCP's delivery configuration (project-owned): delivery.config.json and delivery.headers,
// checked with the vendored kit's own validators.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadConfig } from "../infra/site/src/config.ts";
import { mergeHeaders, parseProjectHeaders, projectHeaders } from "../infra/site/src/local-headers.ts";
import { renderHeaders } from "../infra/site/src/stage.ts";

const config = loadConfig(new URL("../delivery.config.json", import.meta.url).pathname);

test("delivery.config.json: WebMCP names and the deploy gate", () => {
  assert.equal(config.site.name, "docs");
  assert.equal(config.site.worker, "webmcp-sdk-docs");
  assert.equal(config.site.htmlHandling, "drop-trailing-slash");
  assert.equal(config.site.server, false);
  // Gate: checks that run on BOTH pull_request and push. dependency-review is PR-only: required by
  // the ruleset, never by the deploy gate. `docs` (ci.yml) is added with apps/docs (PR #6).
  assert.deepEqual(config.previews.requiredChecks, ["checks", "browser", "workflow-lint", "docs-build"]);
  assert.ok(!config.previews.requiredChecks.includes("dependency-review"));
  assert.deepEqual(config.release.packages, ["packages/webmcp-sdk"]);
});

test("delivery.headers: project security headers, no duplicate of the kit's", () => {
  const { rules, global } = projectHeaders(new URL("..", import.meta.url).pathname);
  const names = global.map(([n]) => n);
  assert.deepEqual(names, ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy"]);
  const csp = new Map(global.find(([n]) => n === "Content-Security-Policy")![1].split("; ").map((d) => [d.split(" ")[0], d]));
  for (const d of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok([...csp.values()].includes(d), d);
  assert.doesNotMatch(global.find(([n]) => n === "Content-Security-Policy")![1], /unsafe-eval|https?:\/\//);
  assert.match(rules, /\n\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n$/);
  const all = mergeHeaders(renderHeaders("pr-6", "pr-6@abcdef0"), rules);
  const patterns = all.split("\n").filter((l) => l.startsWith("/"));
  assert.equal(new Set(patterns).size, patterns.length, "a pattern appears twice (Cloudflare rejects the file)");
  assert.deepEqual(patterns, ["/*", "/r/*", "/assets/*"]);
  for (const line of all.split("\n")) assert.ok(line.length <= 2000);
  assert.ok(all.split("\n").filter((l) => l.startsWith("/")).length <= 100);
  for (const kit of ["X-Content-Type-Options", "Referrer-Policy", "X-Robots-Tag", "X-Delivery-Revision"]) assert.equal(all.split(`${kit}:`).length - 1, 1, kit);
  assert.doesNotMatch(mergeHeaders(renderHeaders("production"), rules), /X-Robots-Tag/);
});

test("delivery.headers parser refuses what would break or duplicate", () => {
  assert.throws(() => parseProjectHeaders("/*\n  X-Content-Type-Options: nosniff\n"), /set by the kit/);
  assert.throws(() => parseProjectHeaders("  X-A: 1\n"), /malformed/);
  assert.throws(() => parseProjectHeaders("assets/*\n  X-A: 1\n"), /start with a path/);
  assert.throws(() => parseProjectHeaders(`/*\n  X-A: ${"a".repeat(2001)}\n`), /2,000/);
  assert.deepEqual(parseProjectHeaders("# c\n/x\n  X-A: 1\n").global, []);
});

test("site:build lays out apps/docs/out as the kit's assets/ (script wiring)", () => {
  const script = readFileSync(new URL("./docs-site-build.mjs", import.meta.url), "utf8");
  assert.match(script, /pnpm", \["docs:build"\]/);
  assert.match(script, /apps\/docs\/out"\), join\(out, "assets"\)/);
});
