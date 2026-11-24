// Preview re-checks, comment and orphan sweep (pure). The plan is deploy-plan.ts; the policy
// (which PR gets a preview) is deploy-plan.ts `eligibility`, shared by every function here.
// Adapted from webmcp-sdk infra/docs/src/preview.ts.

import { eligibility, type PolicyContext } from "./deploy-plan.ts";
import { previewNumberFromWorker } from "./stage.ts";

const SHA = /^[0-9a-f]{40}$/;

export interface PullRequest {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; repo?: { full_name: string } };
  user?: { login?: string } | null;
  closed_at?: string | null;
}

export type PreviewAction =
  | { action: "deploy" }
  | { action: "teardown"; reason: "closed" }
  | { action: "skip"; reason: string };

/**
 * Re-check (before deploying and before commenting), from the PR as the API returns it NOW.
 * The plan itself is deploy-plan.ts; this only answers "still deploy this SHA?". Drafts deploy.
 */
export function previewAction(pr: PullRequest, sha: string, ciConclusion: string | null, ctx: PolicyContext): PreviewAction {
  const verdict = eligibility(pr, ctx);
  if (!verdict.eligible) return verdict.why === "closed" ? { action: "teardown", reason: "closed" } : { action: "skip", reason: verdict.why };
  if (pr.head.sha !== sha) return { action: "skip", reason: "superseded" };
  if (ciConclusion !== "success") return { action: "skip", reason: `CI concluded ${ciConclusion ?? "without conclusion"}` };
  return { action: "deploy" };
}

/**
 * After a deploy, the PR may have been closed (or retargeted) while it ran: destroy what was just
 * deployed. Superseded is fine: the newer commit's run is queued behind this one and overwrites it.
 */
export function afterDeploy(pr: PullRequest | undefined, ctx: PolicyContext): "keep" | "destroy" {
  return eligibility(pr, ctx).eligible ? "keep" : "destroy";
}

/** A preview is an orphan exactly when its PR is not eligible (closed, gone, fork, other base, bot not opted in). Drafts are not orphans. */
export function isOrphan(pr: PullRequest | undefined, ctx: PolicyContext): boolean {
  return !eligibility(pr, ctx).eligible;
}

/**
 * v0.4.2: the sweep also runs on every privileged run (event-driven), so it can meet the event
 * teardown of a PR that was JUST closed (same or another run, different concurrency group). A PR
 * closed less than this ago is left to its teardown; the next sweep removes it if that failed.
 */
export const SWEEP_GRACE_MINUTES = 15;

export type SweepDecision = "remove" | "keep" | "defer";

export function sweepDecision(pr: PullRequest | undefined, ctx: PolicyContext, now: number): SweepDecision {
  if (!isOrphan(pr, ctx)) return "keep";
  const closedAt = pr?.state === "closed" && pr.closed_at ? Date.parse(pr.closed_at) : NaN;
  if (Number.isFinite(closedAt) && now - closedAt < SWEEP_GRACE_MINUTES * 60_000) return "defer";
  return "remove";
}

/**
 * PR numbers from `alchemy state list <stack>` output (one path per line: `<stack>/pr-12/` or
 * `pr-12/`). From webmcp-sdk parsePreviewStages: the sweep unions this with the Worker list, so
 * a stage with state but no Worker (failed deploy) and a Worker without state are both found.
 */
export function previewNumbersFromState(listing: string, stack: string): number[] {
  const out = new Set<number>();
  for (const raw of listing.split("\n")) {
    const parts = raw.trim().replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0] === stack) parts.shift();
    const m = parts.length === 1 ? /^pr-([1-9][0-9]{0,6})$/.exec(parts[0]!) : null;
    if (m?.[1]) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

export function previewNumbers(base: string, workerNames: readonly string[]): number[] {
  const out = new Set<number>();
  for (const name of workerNames) {
    const n = previewNumberFromWorker(base, name);
    if (n !== undefined) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

// --- PR comment ---------------------------------------------------------------------------------

export const commentMarker = (project: string) => `<!-- delivery-kit:${project}:preview -->`;
const BOT_LOGIN = "github-actions[bot]";

export interface IssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
}

/** The one comment this workflow owns on a PR (edited in place: stable URL, no comment spam). */
export function findComment(comments: readonly IssueComment[], project: string): IssueComment | undefined {
  return comments.find((c) => c.user?.login === BOT_LOGIN && c.body?.includes(commentMarker(project)));
}

export type CommentStatus =
  | "building" // the site build of this commit started
  | "deploying" // build green, gate passed, deploy starting
  | "deployed"
  | "failed" // build or deploy failed
  | "removed"
  | "removal-failed"
  | "not-deployed-fork"
  | "not-deployed-bot";

/** The status and commit the comment currently shows (hidden line), to never go backwards. */
export function commentState(body: string | null | undefined): { status: string; sha: string } | undefined {
  const m = /<!-- state:([a-z-]+):([0-9a-f]{40}|-) -->/.exec(body ?? "");
  return m ? { status: m[1]!, sha: m[2]! } : undefined;
}

/**
 * Should this write replace what the comment shows? Progress notices ("building", "deploying")
 * never overwrite a final state of the SAME commit (a late notice after the deploy finished).
 */
const PROGRESS: Record<string, number> = { building: 1, deploying: 2, deployed: 3, failed: 3 };

export function shouldWrite(current: { status: string; sha: string } | undefined, next: CommentStatus, sha: string | undefined): boolean {
  if (!current) return true;
  if ((next === "building" || next === "deploying") && current.sha === sha) return PROGRESS[next]! > (PROGRESS[current.status] ?? 0);
  if ((next === "not-deployed-fork" || next === "not-deployed-bot") && current.status === next) return false;
  return true;
}

export function renderComment(input: { project: string; status: CommentStatus; sha?: string; url?: string; runUrl: string; reason?: string; botVar?: string }): string {
  if (input.sha !== undefined && !SHA.test(input.sha)) throw new Error("invalid commit SHA");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(input.runUrl)) throw new Error("invalid run URL");
  if (input.url !== undefined && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/$/.test(input.url)) throw new Error("invalid preview URL");
  if (input.botVar !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(input.botVar)) throw new Error("invalid variable name");
  const short = input.sha ? `\`${input.sha.slice(0, 7)}\`` : "(unknown commit)";
  const run = `[run](${input.runUrl})`;
  const why = { closed: "PR closed", sweep: "orphan cleanup", manual: "manual teardown" }[input.reason ?? "manual"] ?? "teardown";
  const line = {
    building: `⏳ **Preview:** waiting for the site build of commit ${short} — ${run}`,
    deploying: `🚀 **Preview:** deploying commit ${short} — ${run}`,
    deployed: `✅ **Preview:** ${input.url} — commit ${short} — ${run}`,
    failed: `❌ **Preview not updated:** build or deploy of commit ${short} failed — ${run}. The previous preview, if any, is unchanged.`,
    removed: `🧹 **Preview removed** (${why}) — ${run}`,
    "removal-failed": `⚠️ **Preview removal failed** (${why}) — ${run}. Will retry: the next sweep (on the next deploy run of this repository, or its hourly cron) removes it.`,
    "not-deployed-fork": `🔒 **Preview not deployed:** fork PR. Fork PRs never get a preview (untrusted code, no access to deploy credentials).`,
    "not-deployed-bot": `🤖 **Preview not deployed:** dependency-bot PR. Opt in with the repository variable \`${input.botVar ?? "<SITE>_PREVIEW_DEPENDABOT"}\` = \`true\`.`,
  }[input.status];
  return [
    commentMarker(input.project),
    `<!-- state:${input.status}:${input.sha ?? "-"} -->`,
    line,
    "",
    "<sub>Every open same-repository PR into the default branch gets a preview, drafts included, once the site build of its exact commit is green (other checks gate the merge, not the preview). Deployed by the default branch's workflow from the CI artifact; removed on close or merge, and by the sweep that runs with every deploy run.</sub>",
    "",
  ].join("\n");
}
