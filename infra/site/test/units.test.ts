import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkArtifact } from "../src/artifact.ts";
import { checkManifest } from "../src/deploy-plan.ts";
import { loadConfig, previewMode, validateConfig } from "../src/config.ts";
import { evaluateChecks } from "../src/gate.ts";
import { findComment, renderComment, commentMarker, previewNumbersFromState } from "../src/preview.ts";
import { renderHeaders, revisionLabel, stageKind, stateStoreFor, workerName, workersDevUrl, previewNumberFromWorker } from "../src/stage.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const FIXTURE = {
  project: "example",
  site: { name: "site", worker: "example-site", artifact: "apps/site/out", server: false, smokePaths: ["/"] },
  previews: { enabled: true, mode: "dynamic", requiredChecks: ["checks", "site-build"], gateTimeoutMinutes: 30 },
  release: { packages: ["packages/hello"], branches: { main: "latest" }, mode: "stage" },
};

test("config: the repository's config is valid; bad values are refused", () => {
  // The repository's own config (template or adopter) must validate; the rules are then tested on a
  // fixed fixture so these tests pass unchanged in any vendored copy (kit L8).
  loadConfig();
  const c = validateConfig(FIXTURE);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, worker: "x-pr-1" } }), /reserved/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, artifact: "../etc" } }), /relative/);
  assert.throws(() => validateConfig({ ...c, release: { ...c.release, mode: "yolo" } }), /mode/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, serverEntry: "../x.js" } }), /serverEntry/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, name: "my-site" } }), /site\.name/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, htmlHandling: "strip" as never } }), /htmlHandling/);
  assert.equal(validateConfig({ ...c, site: { ...c.site, htmlHandling: "drop-trailing-slash" } }).site.htmlHandling, "drop-trailing-slash");
  assert.throws(() => validateConfig({ ...c, previews: { ...c.previews, requiredChecks: ["checks"] } }), /site-build/);
  assert.throws(() => validateConfig({ ...c, previews: { ...c.previews, requiredChecks: ["site-build", "site-preview"] } }), /must not include/);
  assert.equal(previewMode(c, ""), "dynamic");
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, headers: { "/*": { "X-Robots-Tag": "all" } } } }), /set by the kit/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, headers: { "/*": { CSP: "a\nb" } } } }), /one non-empty line/);
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, headers: { "no-slash": { A: "b" } } } }), /pattern/);
  assert.equal(validateConfig({ ...c, site: { ...c.site, domain: { name: "docs.example.com", zoneId: "b".repeat(32) } } }).site.domain?.name, "docs.example.com");
  assert.throws(() => validateConfig({ ...c, site: { ...c.site, domain: { name: "example.com", zoneId: "b".repeat(32) } } }), /apex/);
  assert.equal(previewMode(c, "staging"), "staging");
  assert.throws(() => previewMode(c, "yolo"));
});

test("stages: kinds, reserved look-alikes, names, URLs, stores", () => {
  assert.equal(stageKind("production"), "production");
  assert.equal(stageKind("pr-12"), "preview");
  assert.equal(stageKind("alice"), "local");
  for (const bad of ["prod", "pr-0", "pr-x", "my-state", "PR-1", "../x"]) assert.throws(() => stageKind(bad));
  assert.equal(workerName("example-site", "production"), "example-site");
  assert.equal(workerName("example-site", "pr-7"), "example-site-pr-7");
  assert.equal(workersDevUrl("example-site", "pr-7", "acme"), "https://example-site-pr-7.acme.workers.dev/");
  assert.equal(stateStoreFor("example-site", "production"), "example-site-state");
  assert.equal(stateStoreFor("example-site", "pr-7"), "example-site-preview-state");
  assert.equal(stateStoreFor("example-site", "staging"), "example-site-preview-state");
  assert.throws(() => stateStoreFor("example-site", "alice"));
  assert.equal(previewNumberFromWorker("example-site", "example-site-pr-42"), 42);
  assert.equal(previewNumberFromWorker("example-site", "example-site"), undefined);
  assert.equal(previewNumberFromWorker("example-site", "other-site-pr-42"), undefined);
  assert.equal(previewNumberFromWorker("example-site", "example-site-pr-42-evil"), undefined);
});

test("headers: project headers merge into the kit's blocks, one block per pattern", () => {
  const out = renderHeaders("pr-3", revisionLabel({ pr: 3, sha: SHA }), { "/*": { "Content-Security-Policy": "default-src 'self'", "Referrer-Policy": "no-referrer" }, "/assets/*": { "Cache-Control": "immutable" }, "/r/*": { "Cache-Control": "max-age=60" } });
  const patterns = out.split("\n").filter((l) => l && !l.startsWith(" "));
  assert.deepEqual(patterns, ["/*", "/r/*", "/assets/*"]); // never a repeated pattern (workerd rejects the whole file)
  assert.match(out, /Content-Security-Policy: default-src 'self'/);
  assert.match(out, /Referrer-Policy: no-referrer/);
  assert.doesNotMatch(out, /strict-origin-when-cross-origin/);
  assert.match(out, /X-Robots-Tag: noindex/);
  assert.match(out, /X-Delivery-Revision: pr-3@0123456/);
  assert.match(out, /\/r\/\*\n {2}Access-Control-Allow-Origin: \*\n {2}Cache-Control: max-age=60/);
  assert.throws(() => renderHeaders("production", undefined, { "/*": { "x-robots-tag": "all" } }), /set by the kit/);
});

test("headers: only production is indexable; revision is validated", () => {
  assert.doesNotMatch(renderHeaders("production", revisionLabel({ sha: SHA })), /noindex/);
  assert.match(renderHeaders("pr-3", revisionLabel({ pr: 3, sha: SHA })), /noindex[\s\S]*X-Delivery-Revision: pr-3@0123456/);
  assert.match(renderHeaders("production"), /\/r\/\*\n {2}Access-Control-Allow-Origin: \*/);
  assert.throws(() => renderHeaders("pr-3", "pr-3@abc\nX-Evil: 1"));
});

test("sweep: preview stages from alchemy state list", () => {
  assert.deepEqual(previewNumbersFromState("example-site/pr-12/\nexample-site/production/\npr-3/\nexample-site/pr-0/\nexample-site/pr-4/sub/\nother/pr-9/\n", "example-site"), [3, 12]);
});

test("registry cache: no-cache on previews, 5 min in production", () => {
  assert.match(renderHeaders("pr-1"), /\/r\/\*[\s\S]*Cache-Control: no-cache/);
  assert.match(renderHeaders("production"), /\/r\/\*[\s\S]*max-age=300/);
});

test("gate: newest run per name, github-actions only, fail closed", () => {
  const run = (id: number, name: string, conclusion: string | null, status = "completed", slug = "github-actions") => ({ id, name, status, conclusion, app: { slug } });
  assert.equal(evaluateChecks([run(1, "e2e", "success")], ["e2e"]).state, "pass");
  assert.equal(evaluateChecks([run(1, "e2e", "failure"), run(2, "e2e", "success")], ["e2e"]).state, "pass");
  assert.equal(evaluateChecks([run(1, "e2e", "skipped")], ["e2e"]).state, "fail");
  assert.equal(evaluateChecks([run(1, "e2e", null, "in_progress")], ["e2e"]).state, "wait");
  assert.equal(evaluateChecks([run(1, "e2e", "success", "completed", "evil-app")], ["e2e"]).state, "wait");
  // Commit statuses count only when written by the Actions bot; check runs win over statuses.
  const st = (id: number, context: string, state: string, login = "github-actions[bot]") => ({ id, context, state, creator: { login } });
  assert.equal(evaluateChecks([], ["lint"], [st(1, "lint", "success")]).state, "pass");
  assert.equal(evaluateChecks([], ["lint"], [st(1, "lint", "success", "mallory")]).state, "wait");
  assert.equal(evaluateChecks([], ["lint"], [st(1, "lint", "success"), st(2, "lint", "error")]).state, "fail");
  assert.equal(evaluateChecks([], ["lint"], [st(1, "lint", "pending")]).state, "wait");
  assert.equal(evaluateChecks([run(1, "lint", "failure")], ["lint"], [st(1, "lint", "success")]).state, "fail");
});

test("comment: one marked bot comment; inputs validated", () => {
  const body = renderComment({ project: "example", status: "deployed", sha: SHA, url: "https://example-site-pr-3.acme.workers.dev/", runUrl: "https://github.com/o/r/actions/runs/1" });
  assert.match(body, /Preview:\*\* https:\/\/example-site-pr-3/);
  assert.ok(body.startsWith(commentMarker("example")));
  const comments = [{ id: 1, body, user: { login: "mallory" } }, { id: 2, body, user: { login: "github-actions[bot]" } }];
  assert.equal(findComment(comments, "example")?.id, 2);
  assert.throws(() => renderComment({ project: "example", status: "deployed", sha: SHA, url: "https://evil.example.com/", runUrl: "https://github.com/o/r/actions/runs/1" }));
});

function artifact(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "artifact-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

test("manifest: must equal the recomputed target", () => {
  const m = { sha: SHA, pr: 3, stage: "pr-3" };
  const full = { ...m, event: "pull_request", action: "synchronize" };
  checkManifest(full, m);
  assert.throws(() => checkManifest({ ...full, pr: 4 }, m), /pr/);
  assert.throws(() => checkManifest({ ...full, stage: "production" }, m), /stage/);
  assert.throws(() => checkManifest({ ...full, sha: "f".repeat(40) }, m), /sha/);
  assert.throws(() => checkManifest({ ...full, extra: 1 }, m), /keys/);
  assert.throws(() => checkManifest(null, m), /object/);
  assert.equal(checkArtifact(artifact({ "assets/index.html": "x", "manifest.json": "{}" }), { server: false }).files, 2);
});

test("artifact: layout, no symlinks, no dotfiles, bounded", () => {
  assert.equal(checkArtifact(artifact({ "assets/index.html": "x", "assets/r/a.json": "{}" }), { server: false }).files, 2);
  assert.throws(() => checkArtifact(artifact({ "assets/x.html": "x" }), { server: false }), /index\.html/);
  assert.throws(() => checkArtifact(artifact({ "assets/index.html": "x", "server/index.js": "" }), { server: false }), /unexpected/);
  assert.throws(() => checkArtifact(artifact({ "assets/index.html": "x" }), { server: true }), /server/);
  assert.throws(() => checkArtifact(artifact({ "assets/index.html": "x", "assets/.env": "" }), { server: false }), /hidden/);
  const linked = artifact({ "assets/index.html": "x" });
  symlinkSync("/etc/passwd", join(linked, "assets", "passwd"));
  assert.throws(() => checkArtifact(linked, { server: false }), /symlink/);
  // Real TanStack Start output: entry server.js, route chunks with parentheses.
  const ssr = { "assets/index.html": "x", "server/server.js": "", "server/assets/(docs)-K0Micpkv.js": "" };
  assert.equal(checkArtifact(artifact(ssr), { server: true, serverEntry: "server.js" }).files, 3);
  assert.throws(() => checkArtifact(artifact(ssr), { server: true }), /server\/index\.js is missing/);
  assert.throws(() => checkArtifact(artifact({ ...ssr, "server/server.js.map": "{}" }), { server: true, serverEntry: "server.js" }), /source maps/);
  assert.throws(() => checkArtifact(artifact({ "assets/index.html": "x", "assets/a b.js": "" }), { server: false }), /unsafe/);
  assert.throws(() => checkArtifact(artifact({ "assets/index.html": "x".repeat(20) }), { server: false, limits: { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 100 } }), /larger/);
});
