// Deploy gate: a commit deploys only once every required check run of that exact SHA is green.
// From webmcp-sdk infra/docs/src/gate.ts; required list from delivery.config.json
// previews.requiredChecks; commit statuses accepted too (only those written by GitHub Actions).

/** Only check runs created by GitHub Actions count: another installed app cannot fake a green. */
export const TRUSTED_APP = "github-actions";
/** Commit statuses have no app: only those created by the Actions bot count. */
export const TRUSTED_STATUS_CREATOR = "github-actions[bot]";

export interface CommitStatus {
  id: number;
  context: string;
  state: string; // success | pending | failure | error
  creator?: { login?: string } | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
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
 * Newest run of each name wins (re-runs). Anything but `success` on a completed run fails closed,
 * including `skipped` and `neutral`: a required check that did not really run must not pass.
 */
export function evaluateChecks(runs: readonly CheckRun[], required: readonly string[], statuses: readonly CommitStatus[] = []): GateResult {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) {
    if (run.app?.slug !== TRUSTED_APP) continue;
    const seen = latest.get(run.name);
    if (!seen || run.id > seen.id) latest.set(run.name, run);
  }
  const latestStatus = new Map<string, CommitStatus>();
  for (const st of statuses) {
    if (st.creator?.login !== TRUSTED_STATUS_CREATOR) continue;
    const seen = latestStatus.get(st.context);
    if (!seen || st.id > seen.id) latestStatus.set(st.context, st);
  }
  const result: GateResult = { state: "pass", passed: [], pending: [], missing: [], failed: [] };
  for (const name of required) {
    const run = latest.get(name);
    const st = latestStatus.get(name);
    if (!run && st) {
      if (st.state === "success") result.passed.push(name);
      else if (st.state === "pending") result.pending.push(name);
      else result.failed.push(`${name} (status ${st.state})`);
      continue;
    }
    if (!run) result.missing.push(name);
    else if (run.status !== "completed") result.pending.push(name);
    else if (run.conclusion === "success") result.passed.push(name);
    else result.failed.push(`${name} (${run.conclusion ?? "no conclusion"})`);
  }
  if (result.failed.length) result.state = "fail";
  else if (result.pending.length || result.missing.length) result.state = "wait";
  return result;
}
