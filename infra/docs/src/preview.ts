// Preview lifecycle decisions (pure): deploy or not, the PR comment, and the orphan sweeper.

import { STATE_STORE_WORKER, WORKER_BASE_NAME } from "./stage.ts";

export interface PullRequestState {
  number: number;
  state: string; // open | closed
  draft: boolean;
  head: { sha: string };
}

export type PreviewDecision =
  | { deploy: true }
  | { deploy: false; reason: "closed" | "draft" | "superseded" };

/**
 * Read just before deploying. A preview deploys only for an open, non-draft PR whose head is still
 * the commit this run built: a newer push has its own run, a closed or draft PR is torn down.
 */
export function previewDecision(pr: PullRequestState, builtSha: string): PreviewDecision {
  if (pr.state !== "open") return { deploy: false, reason: "closed" };
  if (pr.draft) return { deploy: false, reason: "draft" };
  if (pr.head.sha !== builtSha) return { deploy: false, reason: "superseded" };
  return { deploy: true };
}

// --- PR comment ---------------------------------------------------------------------------------

export const COMMENT_MARKER = "<!-- webmcp-sdk-docs-preview -->";
const BOT_LOGIN = "github-actions[bot]";

export interface IssueComment {
  id: number;
  body?: string | null;
  user?: { login?: string; type?: string } | null;
}

/** The workflow's own comment: has the marker and was written by github-actions[bot]. */
export function findPreviewComment(comments: readonly IssueComment[]): IssueComment | undefined {
  return comments.find((c) => c.user?.login === BOT_LOGIN && c.body?.includes(COMMENT_MARKER));
}

export type CommentStatus = "deployed" | "failed" | "removed" | "removal-failed";

export interface CommentInput {
  status: CommentStatus;
  sha: string;
  runUrl: string;
  url?: string;
  reason?: string; // closed | draft | manual | sweeper
}

const SHA = /^[0-9a-f]{40}$/;
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/;
const PREVIEW_URL = /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/$/;

export function renderComment(input: CommentInput): string {
  if (!SHA.test(input.sha)) throw new Error("invalid commit SHA");
  if (!RUN_URL.test(input.runUrl)) throw new Error("invalid run URL");
  if (input.url !== undefined && !PREVIEW_URL.test(input.url)) throw new Error("invalid preview URL");
  const short = input.sha.slice(0, 7);
  const run = `[run](${input.runUrl})`;
  const why = input.reason === "draft" ? "the PR is a draft" : input.reason === "closed" ? "the PR is closed" : input.reason === "sweeper" ? "orphan cleanup" : "manual teardown";
  const line = {
    deployed: `✅ **Docs preview deployed:** ${input.url ?? "(no URL)"} — commit \`${short}\` — ${run}`,
    failed: `❌ **Docs preview failed** for commit \`${short}\` — ${run}`,
    removed: `🧹 **Docs preview removed** (${why}) — last commit \`${short}\` — ${run}`,
    "removal-failed": `⚠️ **Docs preview teardown failed** (${why}) — commit \`${short}\` — ${run}. Retry: Actions → docs → Run workflow, \`destroy_preview\` = this PR number.`,
  }[input.status];
  return [
    COMMENT_MARKER,
    line,
    "",
    "<sub>Deployed only for open, non-draft PRs from this repository once every required check of the commit is green, with the infra of main. Removed when the PR is closed or converted to draft.</sub>",
    "",
  ].join("\n");
}

/**
 * What the comment job does after the preview jobs. Deploy results create the comment if missing;
 * teardown results only update an existing one (a PR that never had a preview gets no comment).
 */
export function commentPlan(input: {
  deployResult: string; // success | failure | skipped | cancelled | ""
  deployStatus: string; // deployed | skipped | "" (output of the deploy job)
  teardownResult: string;
}): { status: CommentStatus; createIfMissing: boolean } | undefined {
  if (input.teardownResult === "success") return { status: "removed", createIfMissing: false };
  if (input.teardownResult === "failure") return { status: "removal-failed", createIfMissing: false };
  if (input.deployResult === "failure") return { status: "failed", createIfMissing: true };
  if (input.deployResult === "success" && input.deployStatus === "deployed") return { status: "deployed", createIfMissing: true };
  return undefined;
}

// --- orphan sweeper -----------------------------------------------------------------------------

/**
 * Stages from `alchemy state list webmcp-sdk-docs` output (one path per line, such as
 * `webmcp-sdk-docs/pr-12/` or `pr-12/`). Only well-formed `pr-<n>` stages are returned.
 */
export function parsePreviewStages(listing: string, stack = WORKER_BASE_NAME): number[] {
  const numbers = new Set<number>();
  for (const raw of listing.split("\n")) {
    const parts = raw.trim().replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0] === stack) parts.shift();
    const stage = parts[0];
    if (parts.length !== 1 || !stage || stage === STATE_STORE_WORKER) continue;
    const m = /^pr-([1-9][0-9]{0,6})$/.exec(stage);
    if (m?.[1]) numbers.add(Number(m[1]));
  }
  return [...numbers].sort((a, b) => a - b);
}

/** A preview is an orphan when its PR is closed, a draft, or gone (404). */
export function isOrphan(pr: PullRequestState | undefined): boolean {
  return pr === undefined || pr.state !== "open" || pr.draft;
}
