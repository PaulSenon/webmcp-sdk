// Records a release after the maintainer approved the staged version on npm.
// Run by .github/workflows/release.yml (job "finalize"); idempotent when re-run.
//   node finalize.mjs <pkg.tgz> <release-manifest.json>
// Env: NAME VERSION SHA TAG DIST_TAG EXPECTED_INTEGRITY GH_TOKEN GITHUB_REPOSITORY PACKAGE_DIR(optional)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { changelogSection, finalizeAction, tarballIntegrity } from "./lib.mjs";

const fail = (message) => { console.error(`::error::${message}`); process.exit(1); };
const [tgzPath, manifestPath] = process.argv.slice(2);
const { NAME, VERSION, SHA, TAG, DIST_TAG, EXPECTED_INTEGRITY, GITHUB_REPOSITORY } = process.env;
const packageDir = process.env.PACKAGE_DIR ?? "packages/webmcp-sdk";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const ghJson = (...args) => JSON.parse(gh(...args));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// 1. The bytes we hold are the bytes that were built and staged.
const local = await tarballIntegrity(readFileSync(tgzPath));
if (local !== EXPECTED_INTEGRITY) fail(`artifact integrity ${local} differs from the build output ${EXPECTED_INTEGRITY}`);

// 2. npm serves exactly those bytes (i.e. the stage was approved, not rejected).
let registry;
for (let attempt = 0; attempt < 10 && !registry; attempt++) {
  try {
    registry = execFileSync("npm", ["view", `${NAME}@${VERSION}`, "dist.integrity"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || undefined;
  } catch { /* not visible yet */ }
  if (!registry) await sleep(30_000);
}
if (!registry) fail(`${NAME}@${VERSION} is not on npm: approve the staged version on npmjs.com (2FA), then re-run this job. If you rejected it, nothing is recorded.`);
if (registry !== EXPECTED_INTEGRITY) fail(`INCIDENT: npm serves ${registry} for ${NAME}@${VERSION}, but this run built ${EXPECTED_INTEGRITY}. Do not tag; investigate.`);
try {
  const current = execFileSync("npm", ["view", NAME, `dist-tags.${DIST_TAG}`], { encoding: "utf8" }).trim();
  if (current !== VERSION) console.warn(`::warning::dist-tag ${DIST_TAG} points to ${current}, not ${VERSION} (dist-tags are changed manually).`);
} catch { /* informational only */ }

// 3. Observe the tag and the release independently (a draft release does not create its tag).
const tagSha = (() => {
  try {
    const ref = ghJson("api", `repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}`);
    if (ref.object.type === "commit") return ref.object.sha;
    return ghJson("api", `repos/${GITHUB_REPOSITORY}/git/tags/${ref.object.sha}`).object.sha; // annotated
  } catch { return undefined; }
})();
const releases = ghJson("api", "--paginate", `repos/${GITHUB_REPOSITORY}/releases?per_page=100`).filter((r) => r.tag_name === TAG);
if (releases.length > 1) fail(`several releases exist for ${TAG}; resolve by hand`);
const existing = releases[0];
const assets = [tgzPath, manifestPath];
const assetsMatch = (release) => {
  if (!release) return false;
  return assets.every((path) => release.assets.some((a) => a.name === basename(path) && a.digest === `sha256:${sha256(path)}`));
};
const action = finalizeAction({ tagSha, release: existing && { draft: existing.draft, assetsMatch: assetsMatch(existing) } }, SHA);
console.log(`finalize: tag=${tagSha ?? "absent"} release=${existing ? (existing.draft ? "draft" : "published") : "absent"} -> ${action}`);

if (action === "fail-tag") fail(`tag ${TAG} points to ${tagSha}, not ${SHA}. Possible compromise; never move tags.`);
if (action === "fail-assets") fail(`release ${TAG} is published but its assets do not match this run. Immutable releases cannot be fixed; see docs/releasing.md.`);
if (action === "done") { console.log(`${TAG} is already fully recorded.`); process.exit(0); }

const notesFile = join(mkdtempSync(join(tmpdir(), "notes-")), "notes.md");
const section = changelogSection(readFileSync(join(packageDir, "CHANGELOG.md"), "utf8"), VERSION) ?? "";
writeFileSync(notesFile, `${section}\n\n---\n\nnpm: [\`${NAME}@${VERSION}\`](https://www.npmjs.com/package/${NAME}/v/${VERSION}) · source: ${SHA} · integrity: \`${EXPECTED_INTEGRITY}\`\n`);
const prerelease = DIST_TAG !== "latest";

let draftId;
if (action === "create" || action === "release-on-existing-tag") {
  const args = ["release", "create", TAG, "--draft", "--verify-tag=false", "--title", `${NAME}@${VERSION}`, "--notes-file", notesFile, "--target", SHA];
  if (action === "release-on-existing-tag") args.splice(args.indexOf("--verify-tag=false"), 1, "--verify-tag");
  if (prerelease) args.push("--prerelease", "--latest=false");
  gh(...args);
  draftId = ghJson("api", "--paginate", `repos/${GITHUB_REPOSITORY}/releases?per_page=100`).find((r) => r.tag_name === TAG)?.id;
} else {
  draftId = existing.id;
}
if (!draftId) fail("could not find the draft release");

// Upload (or replace) the assets on the draft, then publish. Publishing makes the release immutable and creates/locks the tag.
gh("release", "upload", TAG, ...assets, "--clobber");
const tagNow = (() => { try { return ghJson("api", `repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}`).object.sha; } catch { return undefined; } })();
if (tagNow !== undefined && tagNow !== SHA) fail(`tag ${TAG} appeared at ${tagNow} while finalizing; stopping.`);
gh("api", "-X", "PATCH", `repos/${GITHUB_REPOSITORY}/releases/${draftId}`, "-F", "draft=false", ...(prerelease ? ["-F", "prerelease=true", "-f", "make_latest=false"] : ["-f", "make_latest=true"]));

// Verify the end state.
const published = ghJson("api", `repos/${GITHUB_REPOSITORY}/releases/${draftId}`);
const finalTag = ghJson("api", `repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}`).object.sha;
if (published.draft || finalTag !== SHA || !assetsMatch(published)) fail(`release ${TAG} did not reach the expected state (draft=${published.draft}, tag=${finalTag}).`);
console.log(`Recorded ${TAG} at ${SHA}: ${published.html_url}`);
