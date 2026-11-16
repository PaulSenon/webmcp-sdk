// WebMCP's delivery configuration (project-owned delivery.config.json), checked with the vendored
// kit's own validators and header renderer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadConfig } from "../infra/site/src/config.ts";
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

test("site.headers: CSP and security headers merged into the kit's blocks, one block per pattern", () => {
  const headers = config.site.headers ?? {};
  const csp = headers["/*"]?.["Content-Security-Policy"] ?? "";
  for (const d of ["default-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(csp.split("; ").includes(d), d);
  assert.doesNotMatch(csp, /unsafe-eval|https?:\/\//);
  for (const stage of ["production", "pr-6"]) {
    const file = renderHeaders(stage, stage === "production" ? "main@abcdef0" : "pr-6@abcdef0", headers);
    const patterns = file.split("\n").filter((l) => l.startsWith("/"));
    assert.equal(new Set(patterns).size, patterns.length, "a pattern repeats: Cloudflare rejects the whole file");
    for (const name of ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "X-Content-Type-Options"]) {
      assert.equal(file.split(`  ${name}:`).length - 1, 1, `${stage} ${name}`);
    }
    assert.match(file, /\n\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n/);
    for (const line of file.split("\n")) assert.ok(line.length <= 2000);
    assert.equal(/X-Robots-Tag/.test(file), stage !== "production");
  }
});

test("site:build lays out apps/docs/out as the kit's assets/ (script wiring)", () => {
  const script = readFileSync(new URL("./docs-site-build.mjs", import.meta.url), "utf8");
  assert.match(script, /pnpm", \["docs:build"\]/);
  assert.match(script, /apps\/docs\/out"\), join\(out, "assets"\)/);
});
