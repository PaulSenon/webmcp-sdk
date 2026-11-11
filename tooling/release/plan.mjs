// Release preflight, run by .github/workflows/release.yml (job "plan") on the dispatched commit.
// Fails closed. Inputs come only from the environment (never interpolated into a shell):
//   REF       github.ref of the dispatch (refs/heads/main or refs/heads/next)
//   SHA       github.sha
//   EXPECTED  the version the maintainer typed in the dispatch form
//   PACKAGE_DIR (optional) default packages/webmcp-sdk
// Writes name, version, dist_tag, sha, tag to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogHasVersion, classifyNpmViewError, deriveDistTag, isSemver, pendingChangesets, releaseTagName } from "./lib.mjs";

const fail = (message) => { console.error(`::error::${message}`); process.exit(1); };
const { REF, SHA, EXPECTED, GITHUB_OUTPUT } = process.env;
const packageDir = process.env.PACKAGE_DIR ?? "packages/webmcp-sdk";

if (!/^[0-9a-f]{40}$/.test(SHA ?? "")) fail("SHA must be a full commit id");
if (!isSemver(EXPECTED)) fail("confirm_version must be a plain semver version such as 0.1.0 or 0.2.0-next.0");

const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const { name, version } = manifest;
if (manifest.private) fail(`${name} is private`);
if (version !== EXPECTED) fail(`${packageDir}/package.json is at ${version}, but the dispatch confirmed ${EXPECTED}. Merge the version PR first, or fix the input.`);

const tag = deriveDistTag(version, REF);
if (!tag.ok) fail(tag.reason);

const pending = pendingChangesets(readdirSync(".changeset"));
if (pending.length) fail(`pending changesets must be versioned first (pnpm changeset version): ${pending.join(", ")}`);
const inPreMode = existsSync(".changeset/pre.json");
if (tag.distTag === "latest" && inPreMode) fail("main is in Changesets prerelease mode (.changeset/pre.json); run `changeset pre exit` first");
if (tag.distTag === "next" && !inPreMode) fail("next must be in Changesets prerelease mode (changeset pre enter next)");

const changelogPath = join(packageDir, "CHANGELOG.md");
if (!existsSync(changelogPath) || !changelogHasVersion(readFileSync(changelogPath, "utf8"), version)) fail(`${changelogPath} has no "## ${version}" section`);

// The registry must positively say "not found"; any other failure stops the release.
try {
  const out = execFileSync("npm", ["view", `${name}@${version}`, "version", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (out.trim()) fail(`${name}@${version} is already on npm. If its tag or GitHub release is missing, re-run the failed "finalize" job of the original run, or follow docs/releasing.md (recovery).`);
} catch (error) {
  if (classifyNpmViewError(String(error.stderr ?? "")) !== "absent") fail(`could not determine whether ${name}@${version} exists on npm:\n${error.stderr ?? error.message}`);
}

const gitTag = releaseTagName(name, version);
const remote = execFileSync("git", ["ls-remote", "--tags", "origin", `refs/tags/${gitTag}`], { encoding: "utf8" }).trim();
if (remote) fail(`tag ${gitTag} already exists (${remote.split(/\s/)[0]}). Investigate; tags are never moved.`);

const outputs = { name, version, dist_tag: tag.distTag, sha: SHA, tag: gitTag };
console.log(JSON.stringify(outputs, null, 2));
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(""));
