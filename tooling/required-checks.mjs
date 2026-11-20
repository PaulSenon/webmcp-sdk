// Ruleset required checks (tooling/setup-github.mjs). Pure + a workflow reader, unit-tested.
// = previews.requiredChecks (gate deploys too) + previews.prOnlyChecks (PR-only: required by the
// ruleset, never gate deploys; default ["dependency-review"]). Every one must be produced by a job
// of .github/workflows, or the ruleset would wait forever for a check that never reports and
// block every PR (found by WebMCP, which has no `changeset` job).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const DEFAULT_PR_ONLY_CHECKS = ["dependency-review"];

export function requiredChecks(config) {
  const prOnly = config.previews.prOnlyChecks ?? DEFAULT_PR_ONLY_CHECKS;
  if (!Array.isArray(prOnly) || !prOnly.every((n) => typeof n === "string" && n.length > 0)) throw new Error("previews.prOnlyChecks must list check names");
  return [...new Set([...config.previews.requiredChecks, ...prOnly])];
}

/** Check names the workflows can report: each job's `name:` (or its id), expressions excluded. */
export function workflowCheckNames(dir) {
  const names = new Set();
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parse(readFileSync(join(dir, f), "utf8")) ?? {};
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      const name = typeof job?.name === "string" ? job.name : id;
      if (!name.includes("${{")) names.add(name);
    }
  }
  return names;
}

export function missingChecks(checks, available) {
  return checks.filter((c) => !available.has(c));
}
