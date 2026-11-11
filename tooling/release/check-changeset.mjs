// CI check for pull requests: a change to the published package needs a change note,
// except for a well-formed version PR (which consumes the notes).
//   node tooling/release/check-changeset.mjs <base-ref>     e.g. origin/main
// Rules (see lib.mjs classifyPullRequest):
//   - the PR adds a .changeset/*.md file                 -> ok
//   - the published version changed                      -> must be a valid version PR
//   - otherwise                                          -> `changeset status --since=<base>` decides
//     (it fails when files of the package changed without a change note)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { changelogHasVersion, classifyPullRequest, pendingChangesets } from "./lib.mjs";

const base = process.argv[2];
if (!base || base.startsWith("-")) { console.error("usage: check-changeset.mjs <base-ref>"); process.exit(2); }
const packageDir = process.env.PACKAGE_DIR ?? "packages/webmcp-sdk";
const repo = resolve(".");
const changesetBin = join(repo, "node_modules/@changesets/cli/bin.js");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const lines = (text) => text.split("\n").filter(Boolean);

const mergeBase = git("merge-base", base, "HEAD");
const nameStatus = lines(git("diff", "--name-status", "--no-renames", mergeBase, "HEAD"));
const byStatus = (s) => nameStatus.filter((l) => l.startsWith(s)).map((l) => l.split("\t")[1]);
const manifestPath = `${packageDir}/package.json`;
const changelogPath = `${packageDir}/CHANGELOG.md`;
const versionAt = (rev) => { try { return JSON.parse(git("show", `${rev}:${manifestPath}`)).version; } catch { return undefined; } };

const basePending = (() => {
  try { return pendingChangesets(lines(git("ls-tree", "--name-only", mergeBase, ".changeset/")).map((p) => p.replace(/^\.changeset\//, ""))).map((f) => `.changeset/${f}`); }
  catch { return []; }
})();

// Version the base in a throwaway worktree to learn which version the pending notes compute.
const expectedVersion = (() => {
  if (!basePending.length) return undefined;
  const dir = mkdtempSync(join(tmpdir(), "changeset-base-"));
  try {
    git("worktree", "add", "--detach", dir, mergeBase);
    const out = join(dir, "status.json");
    execFileSync("node", [changesetBin, "status", `--output=${out}`], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
    const status = JSON.parse(readFileSync(out, "utf8"));
    const name = JSON.parse(readFileSync(join(dir, manifestPath), "utf8")).name;
    return status.releases.find((r) => r.name === name)?.newVersion;
  } finally {
    try { git("worktree", "remove", "--force", dir); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
})();

const headChangelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
const headVersion = versionAt("HEAD");
const verdict = classifyPullRequest({
  added: byStatus("A"), deleted: byStatus("D"), changed: nameStatus.map((l) => l.split("\t")[1]),
  manifestPath, changelogPath, baseVersion: versionAt(mergeBase), headVersion,
  basePending, expectedVersion, headChangelogHasVersion: changelogHasVersion(headChangelog, headVersion ?? ""),
});

switch (verdict.kind) {
  case "changeset": console.log("Change note present."); break;
  case "version-pr": console.log(`Valid version PR: ${headVersion}.`); break;
  case "invalid-version-pr": console.error(`::error::${verdict.reason}`); process.exit(1);
  case "needs-status-check":
    if (pendingChangesets(readdirSync(".changeset")).length === 0 && !nameStatus.some((l) => l.split("\t")[1].startsWith(`${packageDir}/`))) {
      console.log("No package files changed; no change note needed.");
      break;
    }
    execFileSync("node", [changesetBin, "status", `--since=${base}`], { stdio: "inherit" });
    break;
}
