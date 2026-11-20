// Preview re-checks, comment and orphan sweep (pure). The plan is deploy-plan.ts.
// Adapted from webmcp-sdk infra/docs/src/preview.ts.

import { BOTS } from "./deploy-plan.ts";
import { previewNumberFromWorker } from "./stage.ts";

const SHA = /^[0-9a-f]{40}$/;

export interface PullRequest {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string };
  user?: { login?: string } | null;
}

export type PreviewAction =
  | { action: "deploy" }
  | { action: "teardown"; reason: "closed" | "draft" }
  | { action: "skip"; reason: string };

/**
 * Re-check (before deploying and before commenting), from the PR as the API returns it NOW.
 * The plan itself is deploy-plan.ts; this only answers "still deploy this SHA?".
 */
export function previewAction(pr: PullRequest, sha: string, ciConclusion: string | null, ctx: { repo: string; botPreviews?: boolean }): PreviewAction {
  if (pr.head.repo?.full_name !== ctx.repo) return { action: "skip", reason: "fork" };
  if (pr.user?.login && BOTS.has(pr.user.login) && !ctx.botPreviews) return { action: "skip", reason: "bot" };
  if (pr.state !== "open") return { action: "teardown", reason: "closed" };
  if (pr.draft) return { action: "teardown", reason: "draft" };
  if (pr.head.sha !== sha) return { action: "skip", reason: "superseded" };
  if (ciConclusion !== "success") return { action: "skip", reason: `CI concluded ${ciConclusion ?? "without conclusion"}` };
  return { action: "deploy" };
}

/**
 * After a deploy, the PR may have been closed or drafted while it ran: destroy what was just
 * deployed (its teardown run is queued behind this one in the same concurrency group anyway).
 * Superseded is fine: the newer commit's run is queued behind this one and overwrites it.
 */
export function afterDeploy(pr: PullRequest | undefined): "keep" | "destroy" {
  return pr === undefined || pr.state !== "open" || pr.draft ? "destroy" : "keep";
}

/** A preview Worker is an orphan when its PR is closed, a draft, from a fork, or gone (404). */
export function isOrphan(pr: PullRequest | undefined, repo: string): boolean {
  return pr === undefined || pr.state !== "open" || pr.draft || pr.head.repo?.full_name !== repo;
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

export type CommentStatus = "deployed" | "failed" | "removed" | "removal-failed";

export function renderComment(input: { project: string; status: CommentStatus; sha?: string; url?: string; runUrl: string; reason?: string }): string {
  if (input.sha !== undefined && !SHA.test(input.sha)) throw new Error("invalid commit SHA");
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(input.runUrl)) throw new Error("invalid run URL");
  if (input.url !== undefined && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/$/.test(input.url)) throw new Error("invalid preview URL");
  const short = input.sha ? `\`${input.sha.slice(0, 7)}\`` : "(unknown commit)";
  const run = `[run](${input.runUrl})`;
  const why = { closed: "PR closed", draft: "PR converted to draft", sweep: "orphan cleanup", manual: "manual teardown" }[input.reason ?? "manual"] ?? "teardown";
  const line = {
    deployed: `✅ **Preview:** ${input.url} — commit ${short} — ${run}`,
    failed: `❌ **Preview deploy failed** for commit ${short} — ${run}. The previous preview, if any, is unchanged.`,
    removed: `🧹 **Preview removed** (${why}) — ${run}`,
    "removal-failed": `⚠️ **Preview teardown failed** (${why}) — ${run}. The weekly sweep retries; or run the deploy workflow manually with \`destroy_pr\`.`,
  }[input.status];
  return [
    commentMarker(input.project),
    line,
    "",
    "<sub>Same-repository, non-draft PRs only, after every required check of the exact commit is green. Deployed by the default branch's workflow from the CI artifact; removed on close, merge or draft.</sub>",
    "",
  ].join("\n");
}
