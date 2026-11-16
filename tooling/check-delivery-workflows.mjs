// Project wrapper around the vendored kit's workflow invariants (tooling/check-workflows.mjs, not
// modified). Runs every invariant on every workflow, with ONE documented exception:
//
//   release.yml / finalize / W10 (no `cache-mode: none`). WebMCP's release.yml stays untouched
//   (coordinator ruling: release convergence is kit v0.2.0). finalize restores no cache today
//   (setup-node package-manager-cache: false, no cache action), so the gap is formal; adding the
//   line to release.yml is the owner's call (docs/docs-deploy.md §2.2).
//
// Any other finding, or a new one in release.yml, still fails.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkWorkflow } from "./check-workflows.mjs";

export const ALLOWED = ["release.yml: W10 job finalize holds an environment or id-token but does not set cache-mode: none"];

const dir = process.argv[2] ?? ".github/workflows";
const all = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), "utf8")));
const errors = all.filter((e) => !ALLOWED.includes(e));
for (const e of all.filter((e) => ALLOWED.includes(e))) console.log(`::notice::allowed (project exception): ${e}`);
for (const e of errors) console.error(`::error::${e}`);
console.log(errors.length ? `${errors.length} violation(s)` : "workflow invariants ok");
process.exit(errors.length ? 1 : 0);
