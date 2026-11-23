// Privileged deploy planning (<site>-deploy.yml, job deploy-plan, no secrets). Pure decisions.
// Extracted from webmcp-sdk infra/docs/src/deploy-plan.ts @52311db (PR #7); generalised: site
// workflow path, default branch, bots, preview mode from the caller.
//
// Nothing the triggering run produced is trusted: only its id comes from the event; the run is
// read back from the API, the PR is resolved from several API lookups and must have EXACTLY this
// commit as its head. The decision is a reconciliation of the PR's current state (D13, automatic
// previews): eligible (open, drafts included, same repository, into the default branch, not a bot
// unless opted in) + head == built commit + build green -> preview; closed -> teardown (dynamic
// mode); anything else -> skip (the sweep removes a preview that is no longer eligible).
import { prStage, previewStage } from "./stage.ts";

export interface RunInfo {
  id: number;
  event: string; // pull_request | push | workflow_dispatch | …
  head_sha: string;
  head_branch: string | null;
  conclusion: string | null;
  path: string; // ".github/workflows/<site>.yml" (a PR can add another workflow with the same name)
  head_repository: { full_name: string; owner?: { login?: string } } | null;
  pull_requests?: { number: number }[];
}

export interface PrInfo {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string; ref?: string; repo: { full_name: string } | null };
  base: { ref: string; repo?: { full_name: string } };
  user?: { login?: string } | null;
}

export const BOTS = new Set(["dependabot[bot]", "renovate[bot]"]);

// --- the one preview policy (D13) ---------------------------------------------------------------

export interface PolicyContext {
  repo: string;
  defaultBranch: string;
  /** Repository variable <SITE>_PREVIEW_DEPENDABOT === "true" (default: no preview for bot PRs). */
  botPreviews: boolean;
}

export type Ineligible = "gone" | "fork" | "base" | "bot" | "closed";
export type Eligibility = { eligible: true } | { eligible: false; why: Ineligible };

/**
 * Does this PR get a preview? The SAME function decides the plan, the re-checks before and after a
 * deploy, and the sweep, so they cannot drift apart. Drafts are eligible (D13).
 */
export function eligibility(pr: Pick<PrInfo, "state" | "head" | "base" | "user"> | undefined, ctx: PolicyContext): Eligibility {
  if (!pr) return { eligible: false, why: "gone" };
  if (pr.head.repo?.full_name !== ctx.repo || (pr.base.repo && pr.base.repo.full_name !== ctx.repo)) return { eligible: false, why: "fork" };
  if (pr.base.ref !== ctx.defaultBranch) return { eligible: false, why: "base" };
  if (pr.user?.login && BOTS.has(pr.user.login) && !ctx.botPreviews) return { eligible: false, why: "bot" };
  if (pr.state !== "open") return { eligible: false, why: "closed" };
  return { eligible: true };
}

/** A PR is this run's PR only if its head is exactly this commit, from the run's repository, into this repository. */
export function prMatchesRun(pr: PrInfo, run: RunInfo, repo: string): boolean {
  return pr.head.sha === run.head_sha && !!run.head_repository && pr.head.repo?.full_name === run.head_repository.full_name && pr.base.repo?.full_name === repo;
}

/** Among candidates from several lookups; two different matching PRs for one commit: refused. */
export function pickPr(candidates: readonly PrInfo[], run: RunInfo, repo: string): PrInfo | undefined {
  const matches = new Map<number, PrInfo>();
  for (const pr of candidates) if (prMatchesRun(pr, run, repo)) matches.set(pr.number, pr);
  if (matches.size > 1) throw new Error(`commit ${run.head_sha.slice(0, 7)} is the head of several PRs (${[...matches.keys()].join(", ")}): refusing to guess`);
  return [...matches.values()][0];
}

/** What the plan job writes in the PR's sticky comment (privileged comment job, fixed text). */
export type PlanNotice = "building" | "deploying" | "build-failed" | "not-deployed-fork" | "not-deployed-bot";

export type Plan =
  | { action: "deploy-preview"; pr: number; stage: string; reason: string; notice: "deploying" }
  | { action: "teardown-preview"; pr: number; stage: string; reason: string }
  | { action: "deploy-production"; stage: "production"; reason: string }
  | { action: "skip"; reason: string; pr?: number; notice?: PlanNotice };

export interface PlanInput {
  run: RunInfo;
  /** workflow_run activity: "requested" (build started: comment only) or "completed". */
  trigger: "requested" | "completed";
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

export function planFromRun({ run, trigger, repo, defaultBranch, workflowPath, previews, pr, mode, botPreviews, mainHead }: PlanInput): Plan {
  if (run.path !== workflowPath) return { action: "skip", reason: `not ${workflowPath} (${run.path})` };
  if (!SHA.test(run.head_sha)) return { action: "skip", reason: "invalid head SHA" };
  const fromFork = run.head_repository?.full_name !== repo;

  if (run.event === "push") {
    if (fromFork) return { action: "skip", reason: "push run from another repository" };
    if (trigger !== "completed") return { action: "skip", reason: "build started" };
    if (run.head_branch !== defaultBranch) return { action: "skip", reason: `branch ${run.head_branch ?? "?"} is not ${defaultBranch}` };
    if (run.conclusion !== "success") return { action: "skip", reason: `build ${run.conclusion ?? "unknown"}` };
    if (mainHead !== run.head_sha) return { action: "skip", reason: `superseded: ${defaultBranch} has moved, the newer run deploys` };
    return { action: "deploy-production", stage: "production", reason: `head of ${defaultBranch}, build succeeded` };
  }

  if (run.event !== "pull_request") return { action: "skip", reason: `event ${run.event} does not deploy` };
  if (!previews) return { action: "skip", reason: "previews are disabled in delivery.config.json" };
  if (!pr) return { action: "skip", reason: fromFork ? "run from a fork: never deployed" : "no PR has this commit as its head" };
  const number = Number(previewStage(pr.number).slice(3)); // validates the number
  const verdict = eligibility(pr, { repo, defaultBranch, botPreviews });
  // Exceptions are said once, when the build starts (no comment spam on completion).
  const once = <N extends PlanNotice>(n: N) => (trigger === "requested" ? { notice: n } : {});
  if (!verdict.eligible) {
    switch (verdict.why) {
      case "fork":
        return { action: "skip", pr: number, reason: "run from a fork: never deployed", ...(pr.state === "open" ? once("not-deployed-fork") : {}) };
      case "bot":
        return { action: "skip", pr: number, reason: `${pr.user?.login} PR: build only (<SITE>_PREVIEW_DEPENDABOT is not true)`, ...(pr.state === "open" ? once("not-deployed-bot") : {}) };
      case "base":
        return { action: "skip", pr: number, reason: `PR targets ${pr.base.ref}, not ${defaultBranch}` };
      case "closed":
        if (trigger !== "completed") return { action: "skip", pr: number, reason: "PR closed" };
        if (mode !== "dynamic") return { action: "skip", pr: number, reason: "PR closed; staging is shared and never torn down" };
        // Whatever the run's conclusion: closing never depends on the build (the closed run only has
        // the no-op `lifecycle` job, and the sweep catches a run that never came).
        return { action: "teardown-preview", pr: number, stage: previewStage(number), reason: "PR closed" };
      case "gone":
        return { action: "skip", reason: "PR not found" };
    }
  }
  if (trigger === "requested") return { action: "skip", pr: number, reason: "build started", notice: "building" };
  if (run.conclusion !== "success") return { action: "skip", pr: number, reason: `build ${run.conclusion ?? "unknown"}`, ...(run.conclusion === "failure" ? { notice: "build-failed" as const } : {}) };
  return { action: "deploy-preview", pr: number, stage: prStage(mode, number), reason: `open${pr.draft ? " (draft)" : ""}, head == built commit, build succeeded`, notice: "deploying" };
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
