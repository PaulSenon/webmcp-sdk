// Compares the CONTENTS of two package tarballs (file list + bytes), ignoring tar metadata
// such as timestamps. Used before approving a staged release: compare the staged tarball with
// one you built yourself from the same commit (docs/releasing.md, approval checklist).
//   node tooling/release/compare-tarballs.mjs <staged.tgz> <local.tgz>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: compare-tarballs.mjs <a.tgz> <b.tgz>"); process.exit(2); }
const contents = (tgz) => {
  const files = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split("\n").filter((f) => !f.endsWith("/"));
  return new Map(files.map((f) => [f, createHash("sha256").update(execFileSync("tar", ["-xOzf", tgz, f])).digest("hex")]));
};
const left = contents(a);
const right = contents(b);
const problems = [];
for (const [file, hash] of left) {
  if (!right.has(file)) problems.push(`only in ${a}: ${file}`);
  else if (right.get(file) !== hash) problems.push(`differs: ${file}`);
}
for (const file of right.keys()) if (!left.has(file)) problems.push(`only in ${b}: ${file}`);
if (problems.length) {
  console.error(`Tarball contents DIFFER (${problems.length}):\n${problems.join("\n")}\nDo not approve; reject the staged version and investigate.`);
  process.exit(1);
}
console.log(`Identical contents: ${left.size} files.`);
