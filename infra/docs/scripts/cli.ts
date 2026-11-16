// CI helpers for the docs deploy (.github/workflows/docs.yml). Inputs come from the environment
// only, never from argv interpolation in YAML. Outputs go to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY.
//
//   (node infra/docs/scripts/cli.ts <command>)
//   target       PR_NUMBER?, PREVIEW_MODE?, SUBDOMAIN, SHA?, BUILD_STAGE?, BUILD_URL?
//                -> stage, worker, store, url, revision
//   preflight    STAGE, PREVIEW_MODE?, SUBDOMAIN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
//                DOCS_STATE_TOKEN, GH_TOKEN, REPO, ENVIRONMENT
//   plan         GH_TOKEN, REPO, RUN_ID, PREVIEW_MODE?, DEPENDABOT_PREVIEWS?  -> action, sha, pr, stage, reason
//   fetch-artifact GH_TOKEN, REPO, RUN_ID, ARTIFACT_NAME, DEST, EXPECTED_SHA, EXPECTED_PR?, EXPECTED_STAGE -> site_dir
//   status       GH_TOKEN, REPO, SHA, STATE, TARGET_URL?, DESCRIPTION?
//   teardown-decision GH_TOKEN, REPO, PR_NUMBER, FORCE?           -> destroy
//   gate         GH_TOKEN, REPO, SHA, GATE_TIMEOUT_S?, GATE_INTERVAL_S?
//   pr-decision  GH_TOKEN, REPO, PR_NUMBER, BUILT_SHA            -> deploy, reason
//   comment      GH_TOKEN, REPO, PR_NUMBER, SHA?, RUN_URL, URL?, TARGET?, REASON?, DEPLOY_RESULT?, DEPLOY_STATUS?, TEARDOWN_RESULT?
//   sweep        GH_TOKEN, REPO (+ deploy credentials, DOCS_STATE=http)
//   manifest     SHA, PR_NUMBER?, STAGE, EVENT, ACTION?, OUT
//   check-site   DOCS_SITE_DIR
//   headers      STAGE, REVISION?                               -> prints the _headers file
//   smoke        SMOKE_URL, DOCS_SITE_DIR, STAGE, REVISION?
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyToken, workerAccess } from "../src/account.ts";
import { checkManifest, pickPr, planFromRun, type PrInfo, type RunInfo } from "../src/deploy-plan.ts";
import { safeUnzip } from "../src/unzip.ts";
import { ApiError, cloudflare, github } from "../src/api.ts";
import { evaluateChecks, type CheckRun } from "../src/gate.ts";
import { renderHeadersFile } from "../src/headers.ts";
import { isMainOnly, isolationDecision, probeStateStore, storeDecision } from "../src/isolation.ts";
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
  WORKER_BASE_NAME,
  assertRevision,
  assertSubdomain,
  isIndexable,
  parsePreviewMode,
  previewStage,
  prStage,
  revisionLabel,
  stageKind,
  stateStoreFor,
  stateStoreUrl,
  workerName,
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
  // Stage, Worker, state store and URL from trusted inputs (event payload, repository variables,
  // this checkout of main), never from the build job's outputs, which ran untrusted code. When the
  // build's values are given, they must match. PR -> staging (default) or pr-<n> (dynamic mode);
  // no PR -> production (from refs/heads/main only).
  target() {
    const pr = process.env.PR_NUMBER ?? "";
    const mode = parsePreviewMode(process.env.PREVIEW_MODE);
    if (!pr && process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
      throw new Error(`production is deployed from refs/heads/main only, not ${process.env.GITHUB_REF}`);
    }
    const stage = pr ? prStage(mode, pr) : "production";
    // The build job may run before Cloudflare is configured: then it only needs the stage.
    if (!process.env.SUBDOMAIN && process.env.SUBDOMAIN_OPTIONAL === "1") {
      output("stage", stage);
      return;
    }
    const subdomain = assertSubdomain(env("SUBDOMAIN"));
    const url = workersDevUrl(stage, subdomain);
    for (const [key, trusted] of [["BUILD_STAGE", stage], ["BUILD_URL", url]] as const) {
      const claimed = process.env[key];
      if (claimed && claimed !== trusted) {
        throw new Error(`${key} from the build job (${JSON.stringify(claimed)}) differs from ${JSON.stringify(trusted)}`);
      }
    }
    output("stage", stage);
    output("worker", workerName(stage));
    output("store", stateStoreFor(stage));
    output("url", url);
    if (stage !== "production" && process.env.SHA) output("revision", revisionLabel({ pr, sha: process.env.SHA }));
  },
  // Before any alchemy call with a deploy token. Refuses: a token that is not an active account
  // token of this account; a state-store token that is not this stage's store (or a store of
  // another version); a production/staging Worker the token cannot see (bootstrap missing or token
  // not scoped to it); a preview-side token that can reach production (dynamic mode, or a staging
  // token broader than its Worker) unless the environment has a required reviewer.
  async preflight() {
    const stage = env("STAGE");
    const mode = parsePreviewMode(process.env.PREVIEW_MODE);
    const accountId = env("CLOUDFLARE_ACCOUNT_ID");
    const cfToken = env("CLOUDFLARE_API_TOKEN");
    const cf = cloudflare(cfToken);
    const verified = await verifyToken(cf, accountId);
    if (verified.kind !== "account") throw new Error("CLOUDFLARE_API_TOKEN must be an account-owned token of this account (Manage Account → API Tokens), not a user token");

    const store = stateStoreFor(stage);
    const { STATE_STORE_VERSION } = await import("alchemy/State");
    const probe = await probeStateStore(stateStoreUrl(store, assertSubdomain(env("SUBDOMAIN"))), env("DOCS_STATE_TOKEN"));
    const storeOk = storeDecision(probe, STATE_STORE_VERSION, store);
    if (!storeOk.ok) throw new Error(storeOk.reason);

    const gh = github(env("GH_TOKEN"));
    const environment = env("ENVIRONMENT");
    const repo = env("REPO");
    const envInfo = await gh.get<{
      protection_rules?: { type: string; reviewers?: unknown[] }[];
      deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
    }>(`/repos/${repo}/environments/${environment}`);
    const reviewers = (envInfo.protection_rules ?? []).filter((r) => r.type === "required_reviewers").reduce((n, r) => n + (r.reviewers?.length ?? 0), 0);
    const rules = envInfo.deployment_branch_policy?.custom_branch_policies
      ? await gh.list<{ name: string; type?: string }>(`/repos/${repo}/environments/${environment}/deployment-branch-policies?per_page=100`, "branch_policies")
      : [];
    const protection = { reviewers, mainOnly: isMainOnly(envInfo.deployment_branch_policy, rules) };
    const decision = isolationDecision({
      stage,
      mode,
      target: await workerAccess(cf, accountId, workerName(stage)),
      production: stage === "production" ? undefined : await workerAccess(cf, accountId, workerName("production")),
      protection,
    });
    if (!decision.ok) throw new Error(decision.reason);
    for (const note of decision.notes) console.log(`::notice::${note}`);
    console.log(`preflight ok: ${stage} (mode ${mode}), account token active, ${store} v${probe.version}, ${environment}: reviewers ${reviewers}, main-only ${protection.mainOnly}`);
  },
  // docs-deploy: what to do for a completed `docs` run. Only the run id comes from the event;
  // the run, the PR and main's head are read from the API, and the PR is verified against the
  // run (head SHA, same repository). See src/deploy-plan.ts.
  async plan() {
    const gh = github(env("GH_TOKEN"));
    const repo = env("REPO");
    const runId = env("RUN_ID");
    if (!/^\d+$/.test(runId)) throw new Error("RUN_ID must be a number");
    const run = await gh.get<RunInfo>(`/repos/${repo}/actions/runs/${runId}`);
    const owner = repo.split("/")[0];
    const candidates: PrInfo[] = [];
    if (run.head_repository?.full_name === repo && run.event === "pull_request") {
      const numbers = new Set<number>((run.pull_requests ?? []).map((p) => p.number));
      for (const n of numbers) candidates.push(await gh.get<PrInfo>(`/repos/${repo}/pulls/${n}`));
      if (run.head_branch) {
        candidates.push(...(await gh.list<PrInfo>(`/repos/${repo}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`)));
      }
      candidates.push(...(await gh.list<PrInfo>(`/repos/${repo}/commits/${run.head_sha}/pulls?per_page=100`)));
    }
    const pr = pickPr(candidates, run, repo);
    const mainHead = run.event === "pull_request" ? undefined : (await gh.get<{ sha: string }>(`/repos/${repo}/commits/main`)).sha;
    const plan = planFromRun({
      run,
      repo,
      pr,
      mode: parsePreviewMode(process.env.PREVIEW_MODE),
      dependabotPreviews: process.env.DEPENDABOT_PREVIEWS === "true",
      mainHead,
    });
    let final = plan;
    if (plan.action === "deploy-preview" || plan.action === "deploy-production") {
      const artifacts = await gh.list<{ name: string; expired: boolean }>(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, "artifacts");
      if (!artifacts.some((a) => a.name === `docs-site-${plan.stage}` && !a.expired)) {
        final = { action: "skip", reason: `the run has no docs-site-${plan.stage} artifact (no apps/docs yet?)`, ...("pr" in plan ? { pr: plan.pr } : {}) };
      }
    }
    output("action", final.action);
    output("sha", run.head_sha);
    output("pr", "pr" in final && final.pr !== undefined ? String(final.pr) : "");
    output("stage", "stage" in final ? final.stage : "");
    output("reason", final.reason.replace(/[\r\n]/g, " "));
    summary(`### Deploy plan for run ${runId} (\`${run.head_sha.slice(0, 7)}\`): **${final.action}** — ${final.reason}`);
  },
  // Download a run's artifact as a ZIP through the API and extract it safely into DEST (never
  // executed; see src/unzip.ts), then check its manifest against the recomputed values and the
  // site directory against the publishing rules. Prints site_dir.
  async "fetch-artifact"() {
    const token = env("GH_TOKEN");
    const gh = github(token);
    const repo = env("REPO");
    const runId = env("RUN_ID");
    if (!/^\d+$/.test(runId)) throw new Error("RUN_ID must be a number");
    const name = env("ARTIFACT_NAME");
    const list = await gh.list<{ id: number; name: string; expired: boolean; size_in_bytes: number }>(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, "artifacts");
    const artifact = list.find((a) => a.name === name && !a.expired);
    if (!artifact) throw new Error(`run ${runId} has no unexpired artifact ${name}`);
    if (artifact.size_in_bytes > 256 * 1024 * 1024) throw new Error("artifact larger than 256 MiB");
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "webmcp-sdk-docs-infra" },
    });
    if (!res.ok) throw new Error(`artifact download failed: HTTP ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());
    const dest = env("DEST");
    const files = safeUnzip(zip, dest);
    const manifest = checkManifest(JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8")), {
      sha: env("EXPECTED_SHA"),
      pr: process.env.EXPECTED_PR ? Number(process.env.EXPECTED_PR) : null,
      stage: env("EXPECTED_STAGE"),
    });
    const site = join(dest, "site");
    const report = checkSiteDir(site);
    for (const warning of report.warnings) console.log(`::warning::${warning}`);
    console.log(`artifact ${name} (${files} files) ok: manifest ${manifest.stage}@${manifest.sha.slice(0, 7)}, site ${report.files} files`);
    output("site_dir", site);
  },
  // Commit status on the PR head (context docs-preview): informational, not a required check.
  async status() {
    const gh = github(env("GH_TOKEN"));
    const sha = env("SHA");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("SHA must be a full commit SHA");
    const state = env("STATE");
    if (!["success", "failure", "error", "pending"].includes(state)) throw new Error("invalid STATE");
    const url = process.env.TARGET_URL;
    if (url && !/^https:\/\/[a-z0-9.-]+\//.test(url)) throw new Error("invalid TARGET_URL");
    await gh.send("POST", `/repos/${env("REPO")}/statuses/${sha}`, {
      state,
      context: "docs-preview",
      description: (process.env.DESCRIPTION ?? "").slice(0, 140),
      ...(url ? { target_url: url } : {}),
    });
    console.log(`status docs-preview=${state} on ${sha.slice(0, 7)}`);
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
  // Just before a teardown: idempotent and race-safe. A PR that is open and ready again (reopened
  // or marked ready meanwhile) keeps its preview; its own run redeploys it.
  async "teardown-decision"() {
    const gh = github(env("GH_TOKEN"));
    const pr = await gh.get<PullRequestState>(`/repos/${env("REPO")}/pulls/${previewStage(env("PR_NUMBER")).slice(3)}`);
    const destroy = pr.state !== "open" || pr.draft || process.env.FORCE === "true";
    output("destroy", String(destroy));
    if (!destroy) console.log("::notice::PR is open and ready again: keeping the preview");
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
    // Deploys report the built commit; teardowns (incl. manual ones) the PR's current head. Re-read
    // the PR right before commenting: a deploy result for a commit that is no longer the head is
    // not posted (the newer run reports), so the comment never goes backwards.
    const current = await gh.get<PullRequestState>(`/repos/${repo}/pulls/${number}`);
    if (process.env.SHA && (plan.status === "deployed" || plan.status === "failed") && current.head.sha !== process.env.SHA) {
      console.log(`PR head moved to ${current.head.sha.slice(0, 7)}: not commenting for ${process.env.SHA.slice(0, 7)}`);
      return;
    }
    const sha = process.env.SHA || current.head.sha;
    const body = renderComment({
      status: plan.status,
      sha,
      runUrl: env("RUN_URL"),
      ...(process.env.URL ? { url: process.env.URL } : {}),
      ...(process.env.REASON ? { reason: process.env.REASON } : {}),
      target: process.env.TARGET === "staging" ? "staging" : "preview",
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
  // docs-build: the artifact's manifest. Informational for the deploy workflow, which recomputes
  // every value and refuses a mismatch (src/deploy-plan.ts checkManifest).
  manifest() {
    const pr = process.env.PR_NUMBER ? Number(previewStage(process.env.PR_NUMBER).slice(3)) : null;
    const sha = env("SHA");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("SHA must be a full commit SHA");
    const manifest = { sha, pr, stage: env("STAGE"), event: env("EVENT"), action: process.env.ACTION || null };
    stageKind(manifest.stage);
    writeFileSync(env("OUT"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest));
  },
  "check-site"() {
    const report = checkSiteDir(env("DOCS_SITE_DIR"));
    for (const warning of report.warnings) console.log(`::warning::${warning}`);
    console.log(`site ok: ${report.files} files, ${(report.bytes / 1024 / 1024).toFixed(1)} MiB`);
  },
  headers() {
    const stage = env("STAGE");
    stageKind(stage);
    const revision = process.env.REVISION ? assertRevision(process.env.REVISION) : undefined;
    process.stdout.write(renderHeadersFile({ indexable: isIndexable(stage), ...(revision ? { revision } : {}) }));
  },
  async smoke() {
    const stage = env("STAGE");
    const url = env("SMOKE_URL");
    const result = await runSmoke({
      url,
      siteDir: env("DOCS_SITE_DIR"),
      indexable: isIndexable(stage),
      ...(process.env.REVISION ? { revision: assertRevision(process.env.REVISION) } : {}),
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
