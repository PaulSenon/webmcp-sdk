// CI helpers for .github/workflows/site.yml and site-deploy.yml. Inputs only from environment
// variables and the event file (never interpolated into a shell). Outputs to $GITHUB_OUTPUT.
// In privileged jobs this file always comes from the default branch's checkout.
//
//   node infra/site/scripts/cli.ts <command>
//   plan | fetch-artifact | build-target | write-manifest | pr-target | pr-check | main-check | gate | check-artifact | after-deploy | smoke | comment | sweep | delete-worker | preflight
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { MANIFEST, checkArtifact } from "../src/artifact.ts";
import { checkManifest, pickPr, planFromRun, type PrInfo, type RunInfo } from "../src/deploy-plan.ts";
import { safeUnzip } from "../src/unzip.ts";
import { join } from "node:path";
import { cloudflare, github, redact, type GitHubClient } from "../src/api.ts";
import { isMainOnly, isolationDecision, probeStateStore, storeDecision, verifyToken, workerAccess } from "../src/isolation.ts";
import { loadConfig, previewMode, serverEntry } from "../src/config.ts";
import { evaluateChecks, type CheckRun, type CommitStatus } from "../src/gate.ts";
import { afterDeploy, findComment, isOrphan, previewAction, previewNumbers, previewNumbersFromState, renderComment, type CommentStatus, type IssueComment, type PullRequest } from "../src/preview.ts";
import { productionUrl } from "../src/domain.ts";
import { prStage, revisionLabel, stateStoreFor, stateStoreUrl, workerName, workersDevUrl } from "../src/stage.ts";

const config = loadConfig();
const base = config.site.worker;
const env = (name: string, required = true): string => {
  const v = process.env[name] ?? "";
  if (required && !v) throw new Error(`${name} is required`);
  return v;
};
function output(values: Record<string, string | number | boolean>) {
  const lines = Object.entries(values).map(([k, v]) => {
    const s = String(v);
    if (/[\r\n]/.test(s)) throw new Error(`output ${k} contains a newline`);
    return `${k}=${s}\n`;
  });
  process.stdout.write(lines.join(""));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""));
}
const repo = () => env("REPO");
const defaultBranch = () => env("DEFAULT_BRANCH");
const gh = (): GitHubClient => github(env("GH_TOKEN"));

async function getPr(client: GitHubClient, n: number): Promise<PullRequest | undefined> {
  try {
    return await client.get<PullRequest>(`/repos/${repo()}/pulls/${n}`);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined;
    throw error;
  }
}

/** The public URL of a stage: production = the custom domain when configured (D12). */
const stageUrl = (stage: string, subdomain: string) =>
  stage === "production" ? productionUrl(config.site.domain, workersDevUrl(base, stage, subdomain)) : workersDevUrl(base, stage, subdomain);

function targetOutputs(stage: string, sha: string, pr?: number) {
  const subdomain = env("SUBDOMAIN");
  return {
    stage,
    sha,
    pr: pr ?? "",
    worker: workerName(base, stage),
    url: stageUrl(stage, subdomain),
    store: stateStoreFor(base, stage),
    revision: revisionLabel(pr ? { pr, sha } : { sha }),
  };
}

const commands: Record<string, () => Promise<void>> = {
  /**
   * deploy-plan: what to do for a completed <site> run. Only RUN_ID comes from the event; the run,
   * the PR (several lookups, must have this exact head) and the default branch's head come from
   * the API (deploy-plan.ts). Outputs kind = preview | teardown | production | skip.
   */
  async plan() {
    const client = gh();
    const runId = env("RUN_ID");
    if (!/^\d+$/.test(runId)) throw new Error("RUN_ID must be a number");
    const run = await client.get<RunInfo>(`/repos/${repo()}/actions/runs/${runId}`);
    const owner = repo().split("/")[0];
    const candidates: PrInfo[] = [];
    if (run.head_repository?.full_name === repo() && run.event === "pull_request") {
      for (const n of new Set((run.pull_requests ?? []).map((p) => p.number))) {
        const pr = await getPr(client, n);
        if (pr) candidates.push(pr as unknown as PrInfo);
      }
      if (run.head_branch) candidates.push(...(await client.list<PrInfo>(`/repos/${repo()}/pulls?state=all&per_page=100&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`)));
      candidates.push(...(await client.list<PrInfo>(`/repos/${repo()}/commits/${run.head_sha}/pulls?per_page=100`)));
    }
    const pr = pickPr(candidates, run, repo());
    const mainHead = run.event === "push" ? (await client.get<{ sha: string }>(`/repos/${repo()}/commits/${defaultBranch()}`)).sha : undefined;
    let plan = planFromRun({
      run,
      repo: repo(),
      defaultBranch: defaultBranch(),
      workflowPath: `.github/workflows/${config.site.name}.yml`,
      previews: config.previews.enabled,
      pr,
      mode: previewMode(config),
      botPreviews: process.env.BOT_PREVIEWS === "true",
      mainHead,
    });
    if (plan.action === "deploy-preview" || plan.action === "deploy-production") {
      const artifacts = await client.list<{ name: string; expired: boolean }>(`/repos/${repo()}/actions/runs/${runId}/artifacts?per_page=100`, "artifacts");
      if (!artifacts.some((a) => a.name === config.site.name && !a.expired)) plan = { action: "skip", reason: `run ${runId} has no ${config.site.name} artifact`, ...("pr" in plan ? { pr: plan.pr } : {}) };
    }
    console.log(`plan for run ${runId} (${run.head_sha.slice(0, 7)}): ${plan.action} — ${plan.reason}`);
    const kind = { "deploy-preview": "preview", "teardown-preview": "teardown", "deploy-production": "production", skip: "skip" }[plan.action];
    const pn = "pr" in plan && plan.pr !== undefined ? plan.pr : undefined;
    output({ kind, reason: plan.reason.replace(/[\r\n]/g, " "), run_id: runId, pr: pn ?? "", ...("stage" in plan ? targetOutputs(plan.stage, run.head_sha, pn) : { sha: run.head_sha }) });
  },

  /**
   * Download RUN_ID's artifact as a ZIP through the API, extract it with the hardened extractor
   * into an empty DEST (never executed), check the manifest against EXPECT_* and the layout.
   */
  async "fetch-artifact"() {
    const token = env("GH_TOKEN");
    const runId = env("RUN_ID");
    if (!/^\d+$/.test(runId)) throw new Error("RUN_ID must be a number");
    const list = await gh().list<{ id: number; name: string; expired: boolean; size_in_bytes: number }>(`/repos/${repo()}/actions/runs/${runId}/artifacts?per_page=100`, "artifacts");
    const artifact = list.find((a) => a.name === config.site.name && !a.expired);
    if (!artifact) throw new Error(`run ${runId} has no unexpired artifact ${config.site.name}`);
    if (artifact.size_in_bytes > 256 * 1024 * 1024) throw new Error("artifact larger than 256 MiB");
    const res = await fetch(`https://api.github.com/repos/${repo()}/actions/artifacts/${artifact.id}/zip`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "monorepo-delivery-kit" } });
    if (!res.ok) throw new Error(`artifact download failed: HTTP ${res.status}`);
    const dest = env("DEST");
    const files = safeUnzip(Buffer.from(await res.arrayBuffer()), dest);
    const pr = env("EXPECT_PR", false);
    const m = checkManifest(JSON.parse(readFileSync(join(dest, MANIFEST), "utf8")), { sha: env("EXPECT_SHA"), pr: pr ? Number(pr) : null, stage: env("EXPECT_STAGE") });
    const report = checkArtifact(dest, { server: config.site.server, serverEntry: serverEntry(config) });
    console.log(`artifact ${config.site.name} ok: ${files} entries, manifest ${m.stage}@${m.sha.slice(0, 7)}, ${report.bytes} bytes`);
    output({ dir: dest });
  },

  /** Stage outputs for a PR number (manual destroy, sweep). Dynamic mode only. */
  async "pr-target"() {
    if (previewMode(config) !== "dynamic") throw new Error("per-PR stages exist only in dynamic preview mode");
    const stage = prStage("dynamic", env("PR_NUMBER"));
    output({ stage, worker: workerName(base, stage), store: stateStoreFor(base, stage) });
  },

  /** Is this SHA still the open, non-draft, same-repo head of the PR? (CI already green) */
  async "pr-check"() {
    const pr = await getPr(gh(), Number(env("PR_NUMBER")));
    const act = pr ? previewAction(pr, env("SHA"), "success", { repo: repo(), botPreviews: process.env.BOT_PREVIEWS === "true" }) : ({ action: "teardown", reason: "closed" } as const);
    const deploy = act.action === "deploy";
    if (!deploy) console.log(`::notice::preview not deployed: ${act.action === "teardown" ? act.reason : act.reason}`);
    output({ deploy });
  },

  /** Is this SHA still the head of the default branch? (out-of-order pushes) */
  async "main-check"() {
    const head = (await gh().get<{ sha: string }>(`/repos/${repo()}/commits/${defaultBranch()}`)).sha;
    const fresh = head === env("SHA");
    if (!fresh) console.log(`::notice::${defaultBranch()} moved to ${head}: the newer run deploys`);
    output({ deploy: fresh });
  },

  /** Wait (bounded) until every required check of this exact SHA is green; fail closed. */
  async gate() {
    const required = config.previews.requiredChecks;
    const client = gh();
    const sha = env("SHA");
    const deadline = Date.now() + config.previews.gateTimeoutMinutes * 60_000;
    for (;;) {
      const runs = await client.list<CheckRun>(`/repos/${repo()}/commits/${sha}/check-runs?per_page=100`, "check_runs");
      const statuses = await client.list<CommitStatus>(`/repos/${repo()}/commits/${sha}/statuses?per_page=100`);
      const r = evaluateChecks(runs, required, statuses);
      console.log(`gate ${sha.slice(0, 7)}: ${r.state} passed=[${r.passed}] pending=[${r.pending}] missing=[${r.missing}] failed=[${r.failed}]`);
      if (r.state === "pass") return;
      if (r.state === "fail") throw new Error(`required checks failed: ${r.failed.join(", ")}`);
      if (Date.now() > deadline) throw new Error(`gate timed out waiting for ${[...r.pending, ...r.missing].join(", ")}`);
      await sleep(30_000);
    }
  },

  /** In the unprivileged build: stage, URL to bake in, artifact dir. Not trusted by the deploy. */
  async "build-target"() {
    const pr = env("PR_NUMBER", false);
    const stage = pr ? prStage(previewMode(config), pr) : "production";
    const subdomain = env("SUBDOMAIN", false);
    if (!subdomain) console.log("::notice::<SITE>_WORKERS_SUBDOMAIN is not set: building without SITE_URL");
    output({ stage, url: subdomain ? stageUrl(stage, subdomain) : "", dir: config.site.artifact });
  },

  /** Production URLs for the deploy job: the public one (custom domain or workers.dev) + workers.dev. */
  async "prod-url"() {
    const subdomain = env("SUBDOMAIN");
    output({ url: stageUrl("production", subdomain), workers_dev_url: workersDevUrl(base, "production", subdomain), has_domain: Boolean(config.site.domain) });
  },

  async "write-manifest"() {
    const pr = env("PR_NUMBER", false);
    const sha = env("SHA");
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("SHA must be a full commit SHA");
    const manifest = { sha, pr: pr ? Number(pr) : null, stage: env("STAGE"), event: env("EVENT"), action: process.env.ACTION || null };
    writeFileSync(join(env("SITE_ARTIFACT_DIR"), MANIFEST), `${JSON.stringify(manifest)}\n`);
  },

  /** Layout and limits (build side; the deploy side runs it inside fetch-artifact). */
  async "check-artifact"() {
    const report = checkArtifact(env("SITE_ARTIFACT_DIR"), { server: config.site.server, serverEntry: serverEntry(config) });
    for (const w of report.warnings) console.log(`::warning::${w}`);
    console.log(`artifact ok: ${report.files} files, ${report.bytes} bytes${report.hasServer ? `, server ~${Math.round(report.serverGzipBytes / 1024)} KiB gzip` : ""}`);
  },

  async "after-deploy"() {
    const action = afterDeploy(await getPr(gh(), Number(env("PR_NUMBER"))));
    if (action === "destroy") console.log("::warning::the PR was closed or drafted during the deploy: destroying the preview");
    output({ action });
  },

  /**
   * SMOKE_SOFT=1 (custom domain, D12): bounded retries, then a WARNING instead of a failure — on a
   * first attachment DNS/certificate provisioning is outside the deploy's control, and the hard
   * smoke on workers.dev already proved the deployed content.
   */
  async smoke() {
    const url = env("SMOKE_URL");
    const revision = env("REVISION", false);
    const soft = process.env.SMOKE_SOFT === "1";
    const attempts = soft ? 14 : 10; // soft: ~5 min of backoff
    for (const path of config.site.smokePaths) {
      let last = "";
      for (let attempt = 1; attempt <= attempts; attempt++) {
        // Follows redirects (e.g. /docs -> /docs/ trailing-slash handling) but only on the same origin.
        let res: Response;
        try {
          res = await fetch(new URL(path, url), { headers: { "cache-control": "no-cache" } });
        } catch (error) {
          last = `${path}: ${(error as Error).message}${(error as { cause?: { code?: string } }).cause?.code ? ` (${(error as { cause: { code: string } }).cause.code})` : ""}`;
          await sleep(attempt * 3_000);
          continue;
        }
        if (new URL(res.url).origin !== new URL(url).origin) throw new Error(`${path} redirects off-site to ${res.url}`);
        const got = res.headers.get("x-delivery-revision");
        await res.arrayBuffer();
        // The revision header and project headers come from the asset layer's _headers (static
        // responses). A missing one means _headers was rejected (e.g. a repeated pattern).
        const revisionOk = !revision || config.site.server || got === revision;
        const projectOk = config.site.server || Object.entries(config.site.headers?.["/*"] ?? {}).every(([n, v]) => res.headers.get(n) === v);
        if (res.status >= 200 && res.status < 300 && revisionOk && projectOk) {
          last = "";
          break;
        }
        last = `${path}: HTTP ${res.status}, revision ${got ?? "none"}${projectOk ? "" : ", configured site.headers missing"}`;
        await sleep(attempt * 3_000);
      }
      if (last && soft) {
        console.log(`::warning::custom domain not serving yet (${last}): certificate/DNS provisioning can take minutes; check ${url} — bootstrap.ts --domain-only --check reports the attachment`);
        return;
      }
      if (last) throw new Error(`smoke test failed: ${last}`);
      console.log(`smoke ok: ${path}`);
    }
  },

  /** Upsert the PR's single preview comment and the `<site>-preview` commit status. */
  async comment() {
    const client = gh();
    const pr = Number(env("PR_NUMBER"));
    const status = env("STATUS") as CommentStatus;
    const sha = env("SHA", false) || undefined;
    const url = env("URL", false) || undefined;
    const body = renderComment({ project: config.project, status, sha, url, runUrl: env("RUN_URL"), reason: env("REASON", false) || undefined });
    if (status === "deployed" || status === "failed") {
      const now = await getPr(client, pr);
      if (now && sha && now.head.sha !== sha) return console.log(`::notice::PR head moved to ${now.head.sha}: the newer run comments`);
    }
    const comments = await client.list<IssueComment>(`/repos/${repo()}/issues/${pr}/comments?per_page=100`);
    const existing = findComment(comments, config.project);
    if (existing) await client.send("PATCH", `/repos/${repo()}/issues/comments/${existing.id}`, { body });
    else if (status === "deployed" || status === "failed") await client.send("POST", `/repos/${repo()}/issues/${pr}/comments`, { body });
    if (sha && (status === "deployed" || status === "failed")) {
      await client.send("POST", `/repos/${repo()}/statuses/${sha}`, {
        state: status === "deployed" ? "success" : "failure",
        context: `${config.site.name}-preview`,
        description: status === "deployed" ? "Preview deployed" : "Preview deploy failed",
        target_url: status === "deployed" ? url : env("RUN_URL"),
      });
    }
  },

  /** Orphan preview Workers: PR closed, draft, from a fork, or gone. */
  async sweep() {
    const token = env("CLOUDFLARE_API_TOKEN");
    const cf = cloudflare(token);
    const { body } = await cf.request<{ id: string }[]>("GET", `/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/workers/scripts`);
    if (!body?.success) throw new Error(redact("cannot list Workers", [token]));
    const fromWorkers = previewNumbers(base, body.result.map((s) => s.id));
    const listFile = env("STATE_LIST_FILE", false);
    const fromState = listFile && existsSync(listFile) ? previewNumbersFromState(readFileSync(listFile, "utf8"), `${config.project}-site`) : [];
    const numbers = [...new Set([...fromWorkers, ...fromState])].sort((a, b) => a - b);
    const client = gh();
    const orphans: number[] = [];
    for (const n of numbers) if (isOrphan(await getPr(client, n), repo())) orphans.push(n);
    console.log(`previews: workers [${fromWorkers.join(" ")}] state [${fromState.join(" ")}] orphans: [${orphans.join(" ")}]`);
    output({ orphans: orphans.join(" ") });
  },

  /** Fallback after `alchemy destroy`: a preview Worker without state is deleted directly. */
  async "delete-worker"() {
    const stage = prStage("dynamic", env("PR_NUMBER"));
    const name = workerName(base, stage);
    const token = env("CLOUDFLARE_API_TOKEN");
    const { status } = await cloudflare(token).request("DELETE", `/accounts/${env("CLOUDFLARE_ACCOUNT_ID")}/workers/scripts/${name}?force=true`);
    if (status !== 200 && status !== 404) throw new Error(`deleting ${name}: HTTP ${status}`);
    console.log(status === 404 ? `${name}: already gone` : `${name}: deleted`);
  },

  /**
   * Before any alchemy call with a deploy token (WebMCP PR #7 preflight, generalised):
   * the Cloudflare token is an active ACCOUNT-owned token of this account; the state token is the
   * stage's store token and the store speaks this Alchemy's state API; the job's environment
   * releases secrets only to the default branch (or has a reviewer); the token's view of the
   * stage's Worker and of production is consistent with the stage and preview mode.
   */
  async preflight() {
    const stage = env("STAGE");
    const mode = previewMode(config);
    const accountId = env("CLOUDFLARE_ACCOUNT_ID");
    const cfToken = env("CLOUDFLARE_API_TOKEN");
    const cf = cloudflare(cfToken);
    const verified = await verifyToken(cf, accountId);
    if (verified.kind !== "account") throw new Error("CLOUDFLARE_API_TOKEN must be an account-owned token of this account (Manage Account → API Tokens), not a user token");

    const store = stateStoreFor(base, stage);
    if (env("SITE_STATE_STORE") !== store) throw new Error(`SITE_STATE_STORE must be ${store} for stage ${stage}`);
    const { STATE_STORE_VERSION } = (await import("alchemy/State")) as { STATE_STORE_VERSION: number };
    const probe = await probeStateStore(stateStoreUrl(store, env("SUBDOMAIN")), env("SITE_STATE_TOKEN"));
    const storeOk = storeDecision(probe, STATE_STORE_VERSION, store);
    if (!storeOk.ok) throw new Error(storeOk.reason);

    const environment = env("ENVIRONMENT");
    const client = gh();
    const e = await client.get<{ deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null; protection_rules?: { type: string; reviewers?: unknown[] }[] }>(`/repos/${repo()}/environments/${encodeURIComponent(environment)}`);
    const reviewers = (e.protection_rules ?? []).filter((r) => r.type === "required_reviewers").reduce((n, r) => n + (r.reviewers?.length ?? 0), 0);
    const rules = e.deployment_branch_policy?.custom_branch_policies
      ? await client.list<{ name: string; type?: string }>(`/repos/${repo()}/environments/${encodeURIComponent(environment)}/deployment-branch-policies?per_page=100`, "branch_policies")
      : [];
    const protection = { reviewers, mainOnly: isMainOnly(e.deployment_branch_policy, rules, defaultBranch()) };
    const decision = isolationDecision({
      stage,
      mode,
      target: await workerAccess(cf, accountId, workerName(base, stage)),
      production: stage === "production" ? undefined : await workerAccess(cf, accountId, workerName(base, "production")),
      protection,
    });
    if (!decision.ok) throw new Error(decision.reason);
    for (const note of decision.notes) console.log(`::notice::${note}`);
    console.log(`preflight ok: ${stage} (mode ${mode}), account token ${verified.status}, ${store} v${probe.version}, ${environment}: reviewers ${reviewers}, default-branch-only ${protection.mainOnly}`);
  },
};

const name = process.argv[2] ?? "";
const command = commands[name];
if (!command) {
  console.error(`usage: cli.ts <${Object.keys(commands).join(" | ")}>`);
  process.exit(2);
}
command().catch((error: unknown) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
