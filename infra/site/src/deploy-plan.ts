// Privileged deploy planning (<site>-deploy.yml, job deploy-plan, no secrets). Pure decisions.
// Extracted from webmcp-sdk infra/docs/src/deploy-plan.ts @52311db (PR #7); generalised: site
// workflow path, default branch, bots, preview mode from the caller.
//
// Nothing the triggering run produced is trusted: only its id comes from the event; the run is
// read back from the API, the PR is resolved from several API lookups and must have EXACTLY this
// commit as its head, in this repository, into this repository. The decision is a reconciliation
// of the PR's current state: open + ready + head == built commit + build green -> preview;
// closed or draft -> teardown (dynamic mode).
import { prStage, previewStage } from "./stage.ts";

export interface RunInfo {
  id: number;
  event: string; // pull_request | push | workflow_dispatch | …
  head_sha: string;
  head_branch: string | null;
  conclusion: string | null;
  path: string; // ".github/workflows/<site>.yml" (a PR can add another workflow with the same name)
  head_repository: { full_name: string } | null;
  pull_requests?: { number: number }[];
}

export interface PrInfo {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string; ref?: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
  user?: { login?: string } | null;
}

export const BOTS = new Set(["dependabot[bot]", "renovate[bot]"]);

/** A PR is this run's PR only if its head is exactly this commit, in this repository, into this repository. */
export function prMatchesRun(pr: PrInfo, run: RunInfo, repo: string): boolean {
  return pr.head.sha === run.head_sha && pr.head.repo?.full_name === repo && pr.base.repo.full_name === repo;
}

/** Among candidates from several lookups; two different matching PRs for one commit: refused. */
export function pickPr(candidates: readonly PrInfo[], run: RunInfo, repo: string): PrInfo | undefined {
  const matches = new Map<number, PrInfo>();
  for (const pr of candidates) if (prMatchesRun(pr, run, repo)) matches.set(pr.number, pr);
  if (matches.size > 1) throw new Error(`commit ${run.head_sha.slice(0, 7)} is the head of several PRs (${[...matches.keys()].join(", ")}): refusing to guess`);
  return [...matches.values()][0];
}

export type Plan =
  | { action: "deploy-preview"; pr: number; stage: string; reason: string }
  | { action: "teardown-preview"; pr: number; stage: string; reason: string }
  | { action: "deploy-production"; stage: "production"; reason: string }
  | { action: "skip"; reason: string; pr?: number };

export interface PlanInput {
  run: RunInfo;
  repo: string;
  defaultBranch: string;
  /** ".github/workflows/<site>.yml" */
  workflowPath: string;
  previews: boolean;
  pr: PrInfo | undefined;
  mode: "dynamic" | "staging";
  /** Repository variable <SITE>_PREVIEW_DEPENDABOT === "true" (default: build only). */
  botPreviews: boolean;
  /** Current head of the default branch, for push runs. */
  mainHead: string | undefined;
}

const SHA = /^[0-9a-f]{40}$/;

export function planFromRun({ run, repo, defaultBranch, workflowPath, previews, pr, mode, botPreviews, mainHead }: PlanInput): Plan {
  if (run.path !== workflowPath) return { action: "skip", reason: `not ${workflowPath} (${run.path})` };
  if (!SHA.test(run.head_sha)) return { action: "skip", reason: "invalid head SHA" };
  if (run.head_repository?.full_name !== repo) return { action: "skip", reason: "run from a fork: never deployed" };

  if (run.event === "push") {
    if (run.head_branch !== defaultBranch) return { action: "skip", reason: `branch ${run.head_branch ?? "?"} is not ${defaultBranch}` };
    if (run.conclusion !== "success") return { action: "skip", reason: `build ${run.conclusion ?? "unknown"}` };
    if (mainHead !== run.head_sha) return { action: "skip", reason: `superseded: ${defaultBranch} has moved, the newer run deploys` };
    return { action: "deploy-production", stage: "production", reason: `head of ${defaultBranch}, build succeeded` };
  }

  if (run.event !== "pull_request") return { action: "skip", reason: `event ${run.event} does not deploy` };
  if (!previews) return { action: "skip", reason: "previews are disabled in delivery.config.json" };
  if (!pr) return { action: "skip", reason: "no same-repository PR has this commit as its head" };
  const number = Number(previewStage(pr.number).slice(3)); // validates the number
  if (pr.base.ref !== defaultBranch) return { action: "skip", pr: number, reason: `PR targets ${pr.base.ref}, not ${defaultBranch}` };
  if (pr.user?.login && BOTS.has(pr.user.login) && !botPreviews) {
    return { action: "skip", pr: number, reason: `${pr.user.login} PR: build only (<SITE>_PREVIEW_DEPENDABOT is not true)` };
  }
  if (pr.state !== "open" || pr.draft) {
    const why = pr.state !== "open" ? "closed" : "draft";
    if (mode !== "dynamic") return { action: "skip", pr: number, reason: `PR ${why}; staging is shared and never torn down` };
    return { action: "teardown-preview", pr: number, stage: previewStage(number), reason: `PR ${why}` };
  }
  if (run.conclusion !== "success") return { action: "skip", pr: number, reason: `build ${run.conclusion ?? "unknown"}` };
  return { action: "deploy-preview", pr: number, stage: prStage(mode, number), reason: "open, ready, head == built commit, build succeeded" };
}

// --- artifact manifest --------------------------------------------------------------------------

export interface Manifest {
  sha: string;
  pr: number | null;
  stage: string;
  event: string;
  action: string | null;
}

/** The manifest is untrusted data written by the build: it must equal what was recomputed. */
export function checkManifest(raw: unknown, expected: { sha: string; pr: number | null; stage: string }): Manifest {
  if (typeof raw !== "object" || raw === null) throw new Error("manifest is not an object");
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m).sort().join(",");
  if (keys !== "action,event,pr,sha,stage") throw new Error(`unexpected manifest keys: ${keys}`);
  if (m.sha !== expected.sha) throw new Error("manifest sha differs from the run's head SHA");
  if (m.pr !== expected.pr) throw new Error("manifest pr differs from the PR resolved from the API");
  if (m.stage !== expected.stage) throw new Error("manifest stage differs from the recomputed stage");
  if (typeof m.event !== "string" || (m.action !== null && typeof m.action !== "string")) throw new Error("manifest event/action malformed");
  return m as unknown as Manifest;
}
