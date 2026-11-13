// CI helpers for the docs deploy (.github/workflows/docs.yml). Inputs come from the environment
// only, never from argv interpolation in YAML. Outputs go to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY.
//
//   (node infra/docs/scripts/cli.ts <command>)
//   stage        PR_NUMBER?                                     -> stage
//   target       PR_NUMBER?, PRODUCTION_SUBDOMAIN, PREVIEW_SUBDOMAIN?, SINGLE_ACCOUNT?, BUILD_STAGE?, BUILD_URL?
//                                                              -> stage, subdomain, url
//   check-store  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, EXPECTED_SUBDOMAIN
//   gate         GH_TOKEN, REPO, SHA, GATE_TIMEOUT_S?, GATE_INTERVAL_S?
//   pr-decision  GH_TOKEN, REPO, PR_NUMBER, BUILT_SHA            -> deploy, reason
//   comment      GH_TOKEN, REPO, PR_NUMBER, SHA?, RUN_URL, URL?, REASON?, DEPLOY_RESULT?, DEPLOY_STATUS?, TEARDOWN_RESULT?
//   sweep        GH_TOKEN, REPO (+ Cloudflare credentials, DOCS_STATE=cloudflare)
//   check-site   DOCS_SITE_DIR
//   headers      STAGE                                          -> prints the _headers file
//   smoke        SMOKE_URL, DOCS_SITE_DIR, STAGE
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { getWorkersSubdomain, stateStorePresent } from "../src/account.ts";
import { ApiError, cloudflare, github } from "../src/api.ts";
import { evaluateChecks, type CheckRun } from "../src/gate.ts";
import { renderHeadersFile } from "../src/headers.ts";
import {
  commentPlan,
  findPreviewComment,
  isOrphan,
  parsePreviewStages,
  previewDecision,
  renderComment,
  type IssueComment,
  type PullRequestState,
} from "../src/preview.ts";
import { checkSiteDir } from "../src/site-dir.ts";
import { runSmoke } from "../src/smoke.ts";
import {
  STATE_STORE_WORKER,
  WORKER_BASE_NAME,
  isIndexable,
  previewStage,
  resolveSubdomain,
  stageKind,
  workersDevUrl,
} from "../src/stage.ts";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const output = (key: string, value: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`output ${key} contains a line break`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
};
const summary = (markdown: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
};

const commands: Record<string, () => Promise<void> | void> = {
  stage() {
    // pull_request -> pr-<n>; workflow_dispatch with a PR number -> pr-<n>; otherwise production.
    const pr = process.env.PR_NUMBER ?? "";
    const stage = pr ? previewStage(pr) : "production";
    if (!pr && process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
      throw new Error(`production is deployed from refs/heads/main only, not ${process.env.GITHUB_REF}`);
    }
    output("stage", stage);
  },
  // Stage and URL from trusted inputs (event payload, repository variables, this checkout of main),
  // never from the build job's outputs, which ran untrusted code. When the build's values are
  // given, they must match. Also enforces the production/preview account separation.
  target() {
    const pr = process.env.PR_NUMBER ?? "";
    const stage = pr ? previewStage(pr) : "production";
    const subdomain = resolveSubdomain(stage, {
      production: process.env.PRODUCTION_SUBDOMAIN,
      preview: process.env.PREVIEW_SUBDOMAIN,
      singleAccount: process.env.SINGLE_ACCOUNT,
    });
    const url = workersDevUrl(stage, subdomain);
    for (const [key, trusted] of [["BUILD_STAGE", stage], ["BUILD_URL", url]] as const) {
      const claimed = process.env[key];
      if (claimed && claimed !== trusted) {
        throw new Error(`${key} from the build job (${JSON.stringify(claimed)}) differs from ${JSON.stringify(trusted)}`);
      }
    }
    output("stage", stage);
    output("subdomain", subdomain);
    output("url", url);
  },
  // Before any alchemy call with the deploy token: the token's account must be the one this stage
  // belongs to (its workers.dev subdomain is the expected one, so production secrets cannot point
  // at the preview account or the reverse), and the bootstrapped state store must exist, because
  // `alchemy deploy --yes` would otherwise create one (or replace one of another version) in CI.
  async "check-store"() {
    const accountId = env("CLOUDFLARE_ACCOUNT_ID");
    const cf = cloudflare(env("CLOUDFLARE_API_TOKEN"));
    const expected = env("EXPECTED_SUBDOMAIN");
    const actual = await getWorkersSubdomain(cf, accountId);
    if (actual !== expected) {
      throw new Error(`this token's account serves workers.dev subdomain ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}: wrong account for this environment`);
    }
    if (!(await stateStorePresent(cf, accountId))) {
      throw new Error(`state store ${STATE_STORE_WORKER} not found in this account: run the bootstrap first (docs/docs-deploy.md §4)`);
    }
    console.log(`account ok (workers.dev subdomain ${actual}), state store ${STATE_STORE_WORKER} present`);
  },
  // Wait (bounded) until every required check run of SHA is green; fail closed on a failure or a
  // timeout. The list lives in src/gate.ts.
  async gate() {
    const gh = github(env("GH_TOKEN"));
    const repo = env("REPO");
    const sha = env("SHA");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("SHA must be a full commit SHA");
    const timeoutMs = Number(process.env.GATE_TIMEOUT_S ?? 2400) * 1000;
    const intervalMs = Number(process.env.GATE_INTERVAL_S ?? 20) * 1000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const runs = await gh.list<CheckRun>(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, "check_runs");
      const result = evaluateChecks(runs);
      if (result.state === "pass") {
        console.log(`all required checks green for ${sha.slice(0, 7)}: ${result.passed.join(", ")}`);
        summary(`### Deploy gate: passed for \`${sha.slice(0, 7)}\` (${result.passed.join(", ")})`);
        return;
      }
      if (result.state === "fail") {
        summary(`### Deploy gate: FAILED for \`${sha.slice(0, 7)}\`: ${result.failed.join(", ")}`);
        throw new Error(`required checks failed for ${sha.slice(0, 7)}: ${result.failed.join(", ")}`);
      }
      if (Date.now() >= deadline) {
        const waiting = [...result.pending, ...result.missing.map((m) => `${m} (missing)`)];
        summary(`### Deploy gate: TIMED OUT for \`${sha.slice(0, 7)}\`: ${waiting.join(", ")}`);
        throw new Error(`required checks not green after ${timeoutMs / 1000}s: ${waiting.join(", ")}`);
      }
      console.log(`waiting for ${[...result.pending, ...result.missing].join(", ")}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
  // Just before a preview deploy: is the PR still open, not a draft, and is BUILT_SHA its head?
  async "pr-decision"() {
    const gh = github(env("GH_TOKEN"));
    const pr = await gh.get<PullRequestState>(`/repos/${env("REPO")}/pulls/${previewStage(env("PR_NUMBER")).slice(3)}`);
    const decision = previewDecision(pr, env("BUILT_SHA"));
    output("deploy", String(decision.deploy));
    if (!decision.deploy) {
      output("reason", decision.reason);
      console.log(`::notice::not deploying the preview: ${decision.reason}`);
    }
  },
  // Exactly one comment per PR, found by its hidden marker, created or updated in place.
  async comment() {
    const plan = commentPlan({
      deployResult: process.env.DEPLOY_RESULT ?? "",
      deployStatus: process.env.DEPLOY_STATUS ?? "",
      teardownResult: process.env.TEARDOWN_RESULT ?? "",
    });
    if (!plan) {
      console.log("nothing to report on the PR");
      return;
    }
    const gh = github(env("GH_TOKEN"));
    const repo = env("REPO");
    const number = previewStage(env("PR_NUMBER")).slice(3);
    // Deploys report the built commit; teardowns (incl. manual ones) the PR's current head.
    const sha = process.env.SHA || (await gh.get<PullRequestState>(`/repos/${repo}/pulls/${number}`)).head.sha;
    const body = renderComment({
      status: plan.status,
      sha,
      runUrl: env("RUN_URL"),
      ...(process.env.URL ? { url: process.env.URL } : {}),
      ...(process.env.REASON ? { reason: process.env.REASON } : {}),
    });
    const existing = findPreviewComment(await gh.list<IssueComment>(`/repos/${repo}/issues/${number}/comments?per_page=100`));
    if (existing) {
      await gh.send("PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body });
      console.log(`updated comment ${existing.id} (${plan.status})`);
    } else if (plan.createIfMissing) {
      const created = await gh.send<{ id: number }>("POST", `/repos/${repo}/issues/${number}/comments`, { body });
      console.log(`created comment ${created.id} (${plan.status})`);
    } else {
      console.log("no preview comment on this PR (it never had a preview): nothing to update");
    }
  },
  // Weekly orphan sweeper: destroy pr-<n> stages whose PR is closed, a draft, or gone. Runs with the
  // preview environment's Cloudflare credentials, from main's checkout of infra/docs.
  async sweep() {
    const gh = github(env("GH_TOKEN"));
    const repo = env("REPO");
    const alchemy = (args: string[]) =>
      execFileSync("pnpm", ["--filter", "@senon/webmcp-sdk-docs-infra", "exec", "alchemy", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
        maxBuffer: 16 * 1024 * 1024,
      });
    const stages = parsePreviewStages(alchemy(["state", "list", WORKER_BASE_NAME]));
    console.log(`preview stages in state: ${stages.map((n) => `pr-${n}`).join(", ") || "none"}`);
    const readPr = async (n: number) => {
      try {
        return await gh.get<PullRequestState>(`/repos/${repo}/pulls/${n}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return undefined;
        throw error;
      }
    };
    const destroyed: string[] = [];
    for (const n of stages) {
      if (!isOrphan(await readPr(n))) continue;
      if (!isOrphan(await readPr(n))) continue; // re-read right before destroying (reopened meanwhile?)
      alchemy(["destroy", "--stage", `pr-${n}`, "--yes", "--no-input"]);
      destroyed.push(`pr-${n}`);
    }
    summary(`### Preview sweep: ${destroyed.length ? `destroyed ${destroyed.join(", ")}` : "no orphan"} (of ${stages.length} preview stages)`);
  },
  "check-site"() {
    const report = checkSiteDir(env("DOCS_SITE_DIR"));
    for (const warning of report.warnings) console.log(`::warning::${warning}`);
    console.log(`site ok: ${report.files} files, ${(report.bytes / 1024 / 1024).toFixed(1)} MiB`);
  },
  headers() {
    stageKind(env("STAGE"));
    process.stdout.write(renderHeadersFile({ indexable: isIndexable(env("STAGE")) }));
  },
  async smoke() {
    const stage = env("STAGE");
    const url = env("SMOKE_URL");
    const result = await runSmoke({
      url,
      siteDir: env("DOCS_SITE_DIR"),
      indexable: isIndexable(stage),
      timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000),
      log: (line) => console.log(line),
    });
    for (const check of result.checks) console.log(`ok  ${check}`);
    for (const warning of result.warnings) console.log(`::warning::${warning}`);
    for (const failure of result.failures) console.log(`::error::${failure}`);
    summary(
      [
        `### Smoke test (${stage}): ${result.ok ? "passed" : "FAILED"}`,
        "",
        `URL: ${url}`,
        "",
        ...result.checks.map((c) => `- ✅ ${c}`),
        ...result.warnings.map((w) => `- ⚠️ ${w}`),
        ...result.failures.map((f) => `- ❌ ${f}`),
      ].join("\n"),
    );
    if (!result.ok) process.exitCode = 1;
  },
};

const name = process.argv[2] ?? "";
const command = commands[name];
if (!command) {
  console.error(`usage: cli.ts <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
try {
  await command();
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
