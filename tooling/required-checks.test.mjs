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
