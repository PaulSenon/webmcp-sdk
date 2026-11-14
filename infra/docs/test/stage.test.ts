import assert from "node:assert/strict";
import { test } from "node:test";
import { isIndexable, isRemoteStage, previewStage, stageKind, workerName, workersDevUrl } from "../src/stage.ts";

test("stage kinds", () => {
  assert.equal(stageKind("production"), "production");
  assert.equal(stageKind("pr-42"), "preview");
  assert.equal(stageKind("staging"), "staging");
  assert.equal(stageKind("live_isaac"), "local");
  assert.equal(stageKind("dev_isaac"), "local");
  for (const reserved of ["prod", "stage", "pr-", "pr-0", "pr-01", "pr-x", "pr-12-x", "preview-state", "state"]) {
    assert.throws(() => stageKind(reserved), /reserved/, reserved);
  }
  for (const bad of ["", "Production", "-x", "a/b", "a b", "x".repeat(41)]) {
    assert.throws(() => stageKind(bad), /invalid stage/, bad);
  }
});

test("only production, staging and pr-<n> are remote", () => {
  assert.equal(isRemoteStage("staging"), true);
  assert.equal(isRemoteStage("production"), true);
  assert.equal(isRemoteStage("pr-7"), true);
  assert.equal(isRemoteStage("live_isaac"), false);
});

test("preview stage from a PR number", () => {
  assert.equal(previewStage("12"), "pr-12");
  assert.equal(previewStage(3), "pr-3");
  for (const bad of ["", "0", "-1", "1e3", "12 ", "12;rm", "${{x}}", "12345678"]) {
    assert.throws(() => previewStage(bad), /invalid pull request/, bad);
  }
});

test("worker names and URLs", () => {
  assert.equal(workerName("production"), "webmcp-sdk-docs");
  assert.equal(workerName("pr-12"), "webmcp-sdk-docs-pr-12");
  assert.equal(workerName("live_isaac"), "webmcp-sdk-docs-live-isaac");
  assert.equal(workersDevUrl("production", "acme"), "https://webmcp-sdk-docs.acme.workers.dev/");
  assert.equal(workersDevUrl("pr-3", "acme-1"), "https://webmcp-sdk-docs-pr-3.acme-1.workers.dev/");
  for (const bad of ["", "Acme", "a.b", "-a", "a-", "a/b"]) {
    assert.throws(() => workersDevUrl("production", bad), /subdomain/, bad);
  }
  // Longest stage still yields a valid (<= 63 chars) Worker name.
  assert.ok(workerName(`a${"b".repeat(39)}`).length <= 63);
});

test("only production is indexable", () => {
  assert.equal(isIndexable("production"), true);
  assert.equal(isIndexable("pr-1"), false);
  assert.equal(isIndexable("dev_isaac"), false);
});

test("each remote stage has its own Worker and the right state store", async () => {
  const { stateStoreFor, workerName: name, prStage, parsePreviewMode, revisionLabel, stateStoreUrl } = await import("../src/stage.ts");
  assert.equal(name("staging"), "webmcp-sdk-docs-staging");
  assert.equal(stateStoreFor("production"), "webmcp-sdk-docs-state");
  assert.equal(stateStoreFor("staging"), "webmcp-sdk-docs-preview-state");
  assert.equal(stateStoreFor("pr-3"), "webmcp-sdk-docs-preview-state");
  assert.throws(() => stateStoreFor("live_isaac"), /local stage/);
  assert.equal(stateStoreUrl("webmcp-sdk-docs-state", "acme"), "https://webmcp-sdk-docs-state.acme.workers.dev");
  // Store Worker names can never be produced by a stage (no collision with a site Worker).
  for (const s of ["state", "preview-state", "docs-state"]) assert.throws(() => name(s), /reserved/);

  assert.equal(parsePreviewMode(undefined), "staging");
  assert.equal(parsePreviewMode(""), "staging");
  assert.equal(parsePreviewMode("dynamic"), "dynamic");
  assert.throws(() => parsePreviewMode("Dynamic"), /DOCS_PREVIEW_MODE/);
  assert.equal(prStage("staging", 12), "staging");
  assert.equal(prStage("dynamic", 12), "pr-12");
  assert.throws(() => prStage("staging", "12;x"), /invalid pull request/);

  assert.equal(revisionLabel({ pr: 6, sha: "abcdef0123456789" }), "pr-6@abcdef0");
  assert.equal(revisionLabel({ sha: "abcdef0123456789" }), "main@abcdef0");
  assert.throws(() => revisionLabel({ sha: "XYZ" }), /invalid revision/);
});
