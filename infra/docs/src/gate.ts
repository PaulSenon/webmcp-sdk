// Deploy gate: a commit deploys only once every required check run for that exact SHA is green.
// Pure decision logic; the polling loop lives in scripts/cli.ts (`gate`).

/**
 * The single list of checks a commit must pass before it is deployed (preview or production).
 * Names are GitHub Actions job names (check-run names): `checks`, `browser`, `workflow-lint` and
 * `docs` from ci.yml, `docs-build` from docs.yml. The deploy jobs themselves are not listed, so the
 * gate never waits on the job that runs it. `dependency-review` is PR-only and not part of it.
 */
export const REQUIRED_CHECKS = ["checks", "browser", "workflow-lint", "docs", "docs-build"] as const;

/** Only check runs created by GitHub Actions count: another installed app cannot fake a green. */
export const TRUSTED_APP = "github-actions";

export interface CheckRun {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed | waiting | requested | pending
  conclusion: string | null; // success | failure | cancelled | timed_out | skipped | neutral | action_required | stale | null
  app?: { slug?: string } | null;
}

export type GateState = "pass" | "wait" | "fail";

export interface GateResult {
  state: GateState;
  passed: string[];
  pending: string[];
  missing: string[];
  failed: string[];
}

/**
 * Evaluate the check runs of one commit. The newest run of each name wins (re-runs). Anything but
 * `success` on a completed run fails closed, including `skipped` and `neutral`: a required check
 * that did not really run must not let a deploy through.
 */
export function evaluateChecks(runs: readonly CheckRun[], required: readonly string[] = REQUIRED_CHECKS): GateResult {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) {
    if (run.app?.slug !== TRUSTED_APP) continue;
    const seen = latest.get(run.name);
    if (!seen || run.id > seen.id) latest.set(run.name, run);
  }
  const result: GateResult = { state: "pass", passed: [], pending: [], missing: [], failed: [] };
  for (const name of required) {
    const run = latest.get(name);
    if (!run) result.missing.push(name);
    else if (run.status !== "completed") result.pending.push(name);
    else if (run.conclusion === "success") result.passed.push(name);
    else result.failed.push(`${name} (${run.conclusion ?? "no conclusion"})`);
  }
  if (result.failed.length) result.state = "fail";
  else if (result.pending.length || result.missing.length) result.state = "wait";
  return result;
}
