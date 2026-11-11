import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSemver, deriveDistTag, releaseTagName, changelogHasVersion, changelogSection, pendingChangesets,
  classifyNpmViewError, tarballIntegrity, finalizeAction, classifyPullRequest,
} from "./lib.mjs";

test("semver validation rejects anything that is not a plain version", () => {
  for (const ok of ["0.1.0", "1.2.3", "1.0.0-next.0", "10.20.30-next.12"]) assert.ok(isSemver(ok), ok);
  for (const bad of ["v1.0.0", "1.0", "01.0.0", "1.0.0+build", "1.0.0 ", "1.0.0\n", "$(id)", "-1.0.0", "1.0.0;rm", "", undefined]) assert.ok(!isSemver(bad), String(bad));
});

test("dist-tag is derived from version and branch", () => {
  assert.deepEqual(deriveDistTag("0.1.0", "refs/heads/main"), { ok: true, distTag: "latest" });
  assert.deepEqual(deriveDistTag("0.2.0-next.3", "refs/heads/next"), { ok: true, distTag: "next" });
  assert.equal(deriveDistTag("0.2.0-next.3", "refs/heads/main").ok, false); // prerelease from main
  assert.equal(deriveDistTag("0.2.0", "refs/heads/next").ok, false); // stable from next
  assert.equal(deriveDistTag("0.2.0-beta.1", "refs/heads/next").ok, false); // unknown prerelease id
  assert.equal(deriveDistTag("0.1.0", "refs/heads/feature").ok, false);
  assert.equal(deriveDistTag("0.1.0", "refs/tags/v0.1.0").ok, false);
});

test("tag name and changelog helpers", () => {
  assert.equal(releaseTagName("@senon/webmcp-sdk", "0.1.0"), "@senon/webmcp-sdk@0.1.0");
  const log = "# @senon/webmcp-sdk\n\n## 0.2.0\n\n### Minor Changes\n\n- b\n\n## 0.1.0\n\n- a\n";
  assert.ok(changelogHasVersion(log, "0.1.0"));
  assert.ok(!changelogHasVersion(log, "0.1"));
  assert.equal(changelogSection(log, "0.2.0"), "### Minor Changes\n\n- b");
  assert.equal(changelogSection(log, "0.1.0"), "- a");
  assert.equal(changelogSection(log, "9.9.9"), undefined);
  assert.deepEqual(pendingChangesets(["README.md", "config.json", "a.md", "pre.json"]), ["a.md"]);
});

test("only E404/ETARGET count as an absent version", () => {
  assert.equal(classifyNpmViewError("npm error code E404\nnpm error 404 Not Found"), "absent");
  assert.equal(classifyNpmViewError("npm error code ETARGET"), "absent");
  assert.equal(classifyNpmViewError("npm error code ECONNRESET"), "error");
  assert.equal(classifyNpmViewError("npm error code E503"), "error");
  assert.equal(classifyNpmViewError("npm error code E401"), "error");
});

test("tarball integrity matches npm's format", async () => {
  // sha512 of the empty input, base64
  assert.equal(await tarballIntegrity(Buffer.alloc(0)), "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==");
});

test("finalize state table", () => {
  const sha = "a".repeat(40);
  assert.equal(finalizeAction({}, sha), "create");
  assert.equal(finalizeAction({ release: { draft: true, assetsMatch: false } }, sha), "resume-draft");
  assert.equal(finalizeAction({ tagSha: sha }, sha), "release-on-existing-tag");
  assert.equal(finalizeAction({ tagSha: sha, release: { draft: false, assetsMatch: true } }, sha), "done");
  assert.equal(finalizeAction({ tagSha: sha, release: { draft: false, assetsMatch: false } }, sha), "fail-assets");
  assert.equal(finalizeAction({ tagSha: "b".repeat(40) }, sha), "fail-tag");
  assert.equal(finalizeAction({ tagSha: "b".repeat(40), release: { draft: false, assetsMatch: true } }, sha), "fail-tag");
});

test("changeset rule for pull requests", () => {
  const base = {
    added: [], deleted: [], changed: [], manifestPath: "packages/webmcp-sdk/package.json",
    changelogPath: "packages/webmcp-sdk/CHANGELOG.md", baseVersion: "0.1.0", headVersion: "0.1.0",
    basePending: [], expectedVersion: undefined, headChangelogHasVersion: false,
  };
  assert.equal(classifyPullRequest({ ...base, added: [".changeset/cool-cats.md"], changed: [".changeset/cool-cats.md", "packages/webmcp-sdk/src/x.ts"] }).kind, "changeset");
  assert.equal(classifyPullRequest({ ...base, added: [".changeset/README.md"] }).kind, "needs-status-check");
  assert.equal(classifyPullRequest({ ...base, changed: ["packages/webmcp-sdk/src/x.ts"] }).kind, "needs-status-check");

  const versionPr = {
    ...base, headVersion: "0.2.0", expectedVersion: "0.2.0", basePending: [".changeset/a.md"], deleted: [".changeset/a.md"],
    changed: [".changeset/a.md", "packages/webmcp-sdk/package.json", "packages/webmcp-sdk/CHANGELOG.md"], headChangelogHasVersion: true,
  };
  assert.equal(classifyPullRequest(versionPr).kind, "version-pr");
  assert.equal(classifyPullRequest({ ...versionPr, headVersion: "1.0.0" }).kind, "invalid-version-pr");
  assert.equal(classifyPullRequest({ ...versionPr, deleted: [] }).kind, "invalid-version-pr");
  assert.equal(classifyPullRequest({ ...versionPr, changed: [...versionPr.changed, "packages/webmcp-sdk/src/x.ts"] }).kind, "invalid-version-pr");
  assert.equal(classifyPullRequest({ ...versionPr, headChangelogHasVersion: false }).kind, "invalid-version-pr");
  assert.equal(classifyPullRequest({ ...versionPr, expectedVersion: undefined }).kind, "invalid-version-pr");
});
