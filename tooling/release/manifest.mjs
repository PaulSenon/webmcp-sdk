// Describes the release tarball produced by the build job.
//   node tooling/release/manifest.mjs <out-dir>     (expects <out-dir>/pkg.tgz)
// Env: NAME VERSION SHA (from the plan job), GITHUB_SERVER_URL/GITHUB_REPOSITORY/GITHUB_RUN_ID (run URL)
// Writes <out-dir>/release-manifest.json, prints a file list to the step summary,
// and outputs integrity=<npm dist.integrity of pkg.tgz>.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tarballIntegrity } from "./lib.mjs";

const fail = (message) => { console.error(`::error::${message}`); process.exit(1); };
const outDir = process.argv[2];
const { NAME, VERSION, SHA, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
const tgz = join(outDir, "pkg.tgz");
const bytes = readFileSync(tgz);

const packed = JSON.parse(execFileSync("tar", ["-xOzf", tgz, "package/package.json"], { encoding: "utf8" }));
if (packed.name !== NAME || packed.version !== VERSION) fail(`tarball is ${packed.name}@${packed.version}, plan expected ${NAME}@${VERSION}`);

const listing = execFileSync("tar", ["-tzvf", tgz], { encoding: "utf8" }).trim().split("\n");
const files = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split("\n").filter((f) => !f.endsWith("/")).map((path) => ({
  path,
  sha256: createHash("sha256").update(execFileSync("tar", ["-xOzf", tgz, path])).digest("hex"),
}));
const integrity = await tarballIntegrity(bytes);
const manifest = {
  name: NAME, version: VERSION, sha: SHA, integrity, size: bytes.length,
  run: GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined,
  files,
};
writeFileSync(join(outDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `integrity=${integrity}\n`);
if (GITHUB_STEP_SUMMARY) {
  appendFileSync(GITHUB_STEP_SUMMARY, [
    `### Built \`${NAME}@${VERSION}\` from \`${SHA}\``, "",
    `- integrity: \`${integrity}\``, `- size: ${bytes.length} bytes, ${files.length} files`, "",
    "<details><summary>Tarball contents</summary>", "", "```", ...listing, "```", "</details>", "",
  ].join("\n"));
}
console.log(JSON.stringify({ ...manifest, files: files.length }, null, 2));
