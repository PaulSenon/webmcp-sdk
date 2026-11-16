// Privileged deploy planning (.github/workflows/docs-deploy.yml). Pure decision logic.
//
// The deploy workflow is triggered by `workflow_run` of the unprivileged `docs` workflow. Nothing
// that run produced is trusted: not the event payload (its `pull_requests` is empty for forks and
// only a hint otherwise), not the artifact, not the manifest. The plan is derived from the run as
// read back from the API and from the pull request's CURRENT state read from the API, verified
// against the run's head SHA and repository. The decision is a reconciliation: an open, ready PR
// whose head is this commit gets a preview; a closed or draft PR loses it.

import { prStage, previewStage, type PreviewMode } from "./stage.ts";

export const DOCS_WORKFLOW_PATH = ".github/workflows/docs.yml";

export interface RunInfo {
  id: number;
  event: string; // pull_request | push | workflow_dispatch | …
  head_sha: string;
  head_branch: string | null;
  conclusion: string | null;
  path: string;
  head_repository: { full_name: string } | null;
  pull_requests?: { number: number }[];
}

export interface PrInfo {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { ref: string; repo: { full_name: string } };
  user?: { login?: string } | null;
}

/** A PR is this run's PR only if its head is exactly this commit, in this repository, into this repository. */
export function prMatchesRun(pr: PrInfo, run: RunInfo, repo: string): boolean {
  return pr.head.sha === run.head_sha && pr.head.repo?.full_name === repo && pr.base.repo.full_name === repo;
}

/**
 * Pick the PR for a run among candidates gathered from several API lookups (payload hint, branch
 * lookup, commit lookup, manifest hint). Candidates that do not match the run are ignored; two
 * different matching PRs for one commit are ambiguous and refused (fail closed).
 */
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
  /** The verified PR (pickPr), for pull_request runs. */
  pr: PrInfo | undefined;
  mode: PreviewMode;
  /** Repository variable DOCS_PREVIEW_DEPENDABOT === "true" (default: build only, no preview). */
  dependabotPreviews: boolean;
  /** Current head of main, for push / dispatch runs. */
  mainHead: string | undefined;
}

const SHA = /^[0-9a-f]{40}$/;

export function planFromRun({ run, repo, pr, mode, dependabotPreviews, mainHead }: PlanInput): Plan {
  if (run.path !== DOCS_WORKFLOW_PATH) return { action: "skip", reason: `not the docs workflow (${run.path})` };
  if (!SHA.test(run.head_sha)) return { action: "skip", reason: "invalid head SHA" };
  if (run.head_repository?.full_name !== repo) return { action: "skip", reason: "run from a fork: never deployed" };

  if (run.event === "push" || run.event === "workflow_dispatch") {
    if (run.head_branch !== "main") return { action: "skip", reason: `branch ${run.head_branch ?? "?"} is not main` };
    if (run.conclusion !== "success") return { action: "skip", reason: `build ${run.conclusion ?? "unknown"}` };
    if (mainHead !== run.head_sha) return { action: "skip", reason: "superseded: main has moved, the newer run deploys" };
    return { action: "deploy-production", stage: "production", reason: "head of main, build succeeded" };
  }

  if (run.event !== "pull_request") return { action: "skip", reason: `event ${run.event} does not deploy` };
  if (!pr) return { action: "skip", reason: "no same-repository PR has this commit as its head" };
  const number = Number(previewStage(pr.number).slice(3)); // validates the number
  if (pr.base.ref !== "main") return { action: "skip", pr: number, reason: `PR targets ${pr.base.ref}, not main` };
  if (pr.user?.login === "dependabot[bot]" && !dependabotPreviews) {
    return { action: "skip", pr: number, reason: "Dependabot PR: build only (DOCS_PREVIEW_DEPENDABOT is not true)" };
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
