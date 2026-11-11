// Pure release decisions, kept free of I/O so they can be unit-tested (lib.test.mjs).
// Used by plan.mjs, finalize.mjs and check-changeset.mjs. No dependencies.

/** Strict semver 2.0.0 (no leading "v", no build metadata). */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

export const isSemver = (value) => typeof value === "string" && SEMVER.test(value);

/** Release branches and the only dist-tag each may publish to. */
export const RELEASE_BRANCHES = { "refs/heads/main": "latest", "refs/heads/next": "next" };

/**
 * The npm dist-tag is derived from the version, never taken from input:
 * stable -> "latest" (main only); x.y.z-next.N -> "next" (next only). Anything else is refused.
 * @returns {{ ok: true, distTag: string } | { ok: false, reason: string }}
 */
export function deriveDistTag(version, ref) {
  if (!isSemver(version)) return { ok: false, reason: `not a strict semver version: ${JSON.stringify(version)}` };
  const branchTag = RELEASE_BRANCHES[ref];
  if (!branchTag) return { ok: false, reason: `releases run only from ${Object.keys(RELEASE_BRANCHES).join(" or ")}, not ${JSON.stringify(ref)}` };
  const prerelease = version.split("-")[1];
  const tag = prerelease === undefined ? "latest" : /^next\.\d+$/.test(prerelease) ? "next" : undefined;
  if (!tag) return { ok: false, reason: `unsupported prerelease identifier in ${version} (only -next.N)` };
  if (tag !== branchTag) return { ok: false, reason: `${version} publishes to "${tag}", which is not allowed from ${ref} (expects "${branchTag}")` };
  return { ok: true, distTag: tag };
}

/** Git tag name for a release (Changesets monorepo convention). */
export const releaseTagName = (name, version) => `${name}@${version}`;

/** True when CHANGELOG.md text has a "## <version>" heading. */
export const changelogHasVersion = (text, version) =>
  text.split("\n").some((line) => line.trim() === `## ${version}`);

/** The body of the "## <version>" section (until the next "## " heading), trimmed. */
export function changelogSection(text, version) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** Pending change files: top-level .changeset/*.md except README.md. */
export const pendingChangesets = (fileNames) =>
  fileNames.filter((f) => f.endsWith(".md") && f !== "README.md");

/**
 * Classifies an `npm view` failure: only a real "not found" means the version is absent.
 * Network, auth or registry errors must never be read as "absent" (that would trigger a fresh publish attempt).
 * @returns {"absent" | "error"}
 */
export function classifyNpmViewError(stderr) {
  return /\b(E404|ETARGET)\b/.test(stderr) ? "absent" : "error";
}

/** npm's dist.integrity of a tarball: "sha512-" + base64(sha512(bytes)). */
export async function tarballIntegrity(bytes) {
  const { createHash } = await import("node:crypto");
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/**
 * What finalize must do, given the observed GitHub state (tag and release are queried independently,
 * because a draft release does not create its tag until it is published).
 * @param {{ tagSha?: string, release?: { draft: boolean, assetsMatch: boolean } }} state
 * @param {string} expectedSha
 * @returns {"create" | "resume-draft" | "release-on-existing-tag" | "done" | "fail-assets" | "fail-tag"}
 */
export function finalizeAction(state, expectedSha) {
  const { tagSha, release } = state;
  if (tagSha !== undefined && tagSha !== expectedSha) return "fail-tag";
  if (!release) return tagSha === undefined ? "create" : "release-on-existing-tag";
  if (release.draft) return "resume-draft";
  return release.assetsMatch ? "done" : "fail-assets";
}

/**
 * Decides whether a pull request satisfies the changeset rule.
 * @param {object} input
 * @param {string[]} input.added       files added by the PR (repo-relative)
 * @param {string[]} input.deleted     files deleted by the PR
 * @param {string[]} input.changed     all files touched by the PR
 * @param {string} input.manifestPath  path of the published package.json
 * @param {string} input.changelogPath path of the package CHANGELOG.md
 * @param {string|undefined} input.baseVersion  version on the base commit
 * @param {string|undefined} input.headVersion  version on the PR head
 * @param {string[]} input.basePending  pending change files on the base commit (repo-relative)
 * @param {string|undefined} input.expectedVersion  version `changeset status` computes on the base
 * @param {boolean} input.headChangelogHasVersion
 * @returns {{ kind: "changeset" | "version-pr" | "needs-status-check" | "invalid-version-pr", reason?: string }}
 */
export function classifyPullRequest(input) {
  const isChangeset = (f) => /^\.changeset\/[^/]+\.md$/.test(f) && !f.endsWith("/README.md");
  if (input.added.some(isChangeset)) return { kind: "changeset" };
  if (input.baseVersion === input.headVersion) return { kind: "needs-status-check" };
  // The version changed: this must be a well-formed version PR.
  const allowed = (f) => f === input.manifestPath || f === input.changelogPath || f.startsWith(".changeset/");
  const extra = input.changed.filter((f) => !allowed(f));
  if (extra.length) return { kind: "invalid-version-pr", reason: `a version PR may only touch the manifest, CHANGELOG and .changeset/: ${extra.join(", ")}` };
  if (!input.expectedVersion) return { kind: "invalid-version-pr", reason: "no pending changesets on the base branch, so no version bump is expected" };
  if (input.headVersion !== input.expectedVersion) return { kind: "invalid-version-pr", reason: `version is ${input.headVersion}, changesets on the base compute ${input.expectedVersion}` };
  const notConsumed = input.basePending.filter((f) => !input.deleted.includes(f) && !f.startsWith(".changeset/pre/"));
  if (notConsumed.length) return { kind: "invalid-version-pr", reason: `pending changesets not consumed: ${notConsumed.join(", ")}` };
  if (!input.headChangelogHasVersion) return { kind: "invalid-version-pr", reason: `CHANGELOG has no "## ${input.headVersion}" section` };
  return { kind: "version-pr" };
}
