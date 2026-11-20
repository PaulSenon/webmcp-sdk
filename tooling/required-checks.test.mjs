import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PR_ONLY_CHECKS, missingChecks, requiredChecks, workflowCheckNames } from "./required-checks.mjs";

const cfg = (prOnlyChecks) => ({ previews: { requiredChecks: ["checks", "docs-build"], ...(prOnlyChecks ? { prOnlyChecks } : {}) } });

test("PR-only checks come from the config; default is dependency-review only (no changeset)", () => {
  assert.deepEqual(DEFAULT_PR_ONLY_CHECKS, ["dependency-review"]);
  assert.deepEqual(requiredChecks(cfg()), ["checks", "docs-build", "dependency-review"]);
  assert.deepEqual(requiredChecks(cfg(["dependency-review", "changeset"])), ["checks", "docs-build", "dependency-review", "changeset"]);
  assert.deepEqual(requiredChecks(cfg([])), ["checks", "docs-build"]);
  assert.throws(() => requiredChecks(cfg("changeset")), /must list/);
});

test("a required check that no workflow job produces is reported (WebMCP: no changeset job)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  // WebMCP-shaped CI: checks, browser, workflow-lint, dependency-review (+ docs-build in docs.yml)
  writeFileSync(join(dir, "ci.yml"), "name: ci\non: [pull_request]\njobs:\n  checks:\n    name: checks\n    runs-on: x\n    steps: []\n  browser:\n    runs-on: x\n    steps: []\n  workflow-lint:\n    name: workflow-lint\n    runs-on: x\n    steps: []\n  dependency-review:\n    name: dependency-review\n    runs-on: x\n    steps: []\n  matrix:\n    name: \"e2e ${{ matrix.browser }}\"\n    runs-on: x\n    steps: []\n");
  writeFileSync(join(dir, "docs.yml"), "name: docs\non: [pull_request]\njobs:\n  build:\n    name: docs-build\n    runs-on: x\n    steps: []\n");
  const available = workflowCheckNames(dir);
  assert.deepEqual([...available].sort(), ["browser", "checks", "dependency-review", "docs-build", "workflow-lint"]); // expression names skipped
  assert.deepEqual(missingChecks(requiredChecks(cfg()), available), []);
  assert.deepEqual(missingChecks(requiredChecks(cfg(["dependency-review", "changeset"])), available), ["changeset"]);
});

test("the template's own config only requires checks its workflows produce", () => {
  const config = JSON.parse(readFileSync(new URL("../delivery.config.json", import.meta.url), "utf8"));
  assert.deepEqual(missingChecks(requiredChecks(config), workflowCheckNames(new URL("../.github/workflows/", import.meta.url).pathname)), []);
});

// v0.3.3 (Better Upload): matrix job names, expanded statically; anything else is unverifiable.
import { expandMatrix, jobCheckNames, missingChecksError, workflowChecks } from "./required-checks.mjs";

test("static matrix expansion: lists, exclude, include (merge and new combos)", () => {
  assert.deepEqual(expandMatrix({ browser: ["chromium", "firefox", "webkit", "msedge"] }).map((c) => c.browser), ["chromium", "firefox", "webkit", "msedge"]);
  const m = expandMatrix({ browser: ["chromium", "firefox"], os: ["linux", "mac"], exclude: [{ browser: "firefox", os: "mac" }], include: [{ browser: "webkit", os: "mac" }, { browser: "chromium", extra: 1 }] });
  assert.deepEqual(m, [{ browser: "chromium", os: "linux", extra: 1 }, { browser: "chromium", os: "mac", extra: 1 }, { browser: "firefox", os: "linux" }, { browser: "webkit", os: "mac" }]);
  assert.deepEqual(expandMatrix({ include: [{ shard: 1 }, { shard: 2 }] }), [{ shard: 1 }, { shard: 2 }]);
  assert.equal(expandMatrix("${{ fromJSON(needs.plan.outputs.matrix) }}"), undefined);
  assert.equal(expandMatrix({ browser: "${{ fromJSON(inputs.browsers) }}" }), undefined);
});

test("Better Upload's e2e (${{ matrix.browser }}) jobs produce the 4 required names", () => {
  const job = { name: "e2e (${{ matrix.browser }})", strategy: { matrix: { browser: ["chromium", "firefox", "webkit", "msedge"] } } };
  assert.deepEqual(jobCheckNames("e2e", job), { names: ["e2e (chromium)", "e2e (firefox)", "e2e (webkit)", "e2e (msedge)"] });
  // with exclude: the excluded one is NOT produced
  const ex = { ...job, strategy: { matrix: { browser: ["chromium", "webkit"], exclude: [{ browser: "webkit" }] } } };
  assert.deepEqual(jobCheckNames("e2e", ex), { names: ["e2e (chromium)"] });
  // no name: GitHub's default "<id> (<values>)"
  assert.deepEqual(jobCheckNames("e2e", { strategy: { matrix: { browser: ["chromium"], os: ["linux"] } } }), { names: ["e2e (chromium, linux)"] });
});

test("dynamic or unknown expressions are unverifiable, never silently present", () => {
  assert.match(jobCheckNames("e2e", { name: "e2e (${{ matrix.browser }})", strategy: { matrix: "${{ fromJSON(needs.x.outputs.m) }}" } }).unverifiable, /dynamic matrix/);
  assert.match(jobCheckNames("j", { name: "build ${{ github.ref_name }}" }).unverifiable, /outside a matrix/);
  assert.match(jobCheckNames("j", { name: "t (${{ matrix.os }})", strategy: { matrix: { browser: ["a"] } } }).unverifiable, /matrix\.os/);
  assert.match(jobCheckNames("j", { name: "t (${{ matrix.cfg }})", strategy: { matrix: { cfg: [{ a: 1 }] } } }).unverifiable, /static scalar/);

  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  writeFileSync(join(dir, "ci.yml"), "name: ci\non: [pull_request]\njobs:\n  e2e:\n    name: \"e2e (${{ matrix.browser }})\"\n    strategy:\n      matrix: ${{ fromJSON(needs.plan.outputs.browsers) }}\n    runs-on: x\n    steps: []\n");
  const { names, unverifiable } = workflowChecks(dir);
  assert.equal(names.size, 0);
  assert.equal(unverifiable.length, 1);
  const err = missingChecksError(missingChecks(["e2e (chromium)"], names), unverifiable);
  assert.match(err, /required check\(s\) with no job.*e2e \(chromium\)/);
  assert.match(err, /cannot be verified statically.*ci\.yml job e2e: dynamic matrix/s);
  assert.equal(missingChecksError([], unverifiable), undefined); // unverifiable but not required: fine
});

test("a static e2e matrix in a workflow satisfies its required checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  writeFileSync(join(dir, "ci.yml"), "name: ci\non: [pull_request]\njobs:\n  e2e:\n    name: \"e2e (${{ matrix.browser }})\"\n    strategy:\n      fail-fast: false\n      matrix:\n        browser: [chromium, firefox, webkit, msedge]\n    runs-on: x\n    steps: []\n");
  const required = ["e2e (chromium)", "e2e (firefox)", "e2e (webkit)", "e2e (msedge)"];
  assert.deepEqual(missingChecks(required, workflowChecks(dir).names), []);
});
