// Runs cli.ts commands with the env their workflow step really maps (v0.4.1, WebMCP run
// 45280320094: after-deploy had no DEFAULT_BRANCH, so a live preview was reported failed). The
// step's `env:` is evaluated from the rendered workflow for a given trigger (workflow_run /
// schedule), against a fake GitHub API (GITHUB_API_URL). Static complement: check-workflows W12.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const root = new URL("../", import.meta.url).pathname;
const config = JSON.parse(readFileSync(join(root, "delivery.config.json"), "utf8"));
const deploy = parse(readFileSync(join(root, `.github/workflows/${config.site.name}-deploy.yml`), "utf8"));
const REPO = "acme/site";
const SHA = "a".repeat(40);

/** `${{ a.b || 'x' || c }}` only: anything else (&&, functions) is refused, so a test cannot lie. */
function evaluate(value, ctx) {
  return String(value).replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
    if (/&&|\(|==/.test(expr)) throw new Error(`unsupported expression in a tested step: ${expr}`);
    for (const operand of expr.split("||").map((x) => x.trim())) {
      const v = /^'(.*)'$/.exec(operand)?.[1] ?? operand.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
      if (v) return String(v);
    }
    return "";
  });
}

function stepEnv(jobId, stepId, ctx) {
  const job = deploy.jobs[jobId];
  const step = job.steps.find((s) => s.id === stepId);
  assert.ok(step, `${jobId}.${stepId}`);
  const raw = { ...(deploy.env ?? {}), ...(job.env ?? {}), ...(step.env ?? {}) };
  return { env: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, evaluate(v, ctx)])), run: step.run };
}

const pr = (n, o = {}) => ({ number: n, state: o.state ?? "open", draft: o.draft ?? false, head: { sha: SHA, repo: { full_name: REPO } }, base: { ref: "main", repo: { full_name: REPO } }, user: { login: o.login ?? "alice" } });
const PRS = { 7: pr(7, { draft: true }), 8: pr(8, { state: "closed" }), 9: pr(9, { login: "dependabot[bot]" }) };

async function withApi(fn) {
  const server = createServer((req, res) => {
    const m = /^\/repos\/acme\/site\/pulls\/(\d+)$/.exec(req.url ?? "");
    const body = m && PRS[m[1]];
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(body ?? { message: "Not Found" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

async function run(command, env, api) {
  const dir = mkdtempSync(join(tmpdir(), "wfenv-"));
  const out = join(dir, "out");
  const summary = join(dir, "summary");
  writeFileSync(out, "");
  writeFileSync(summary, "");
  // async spawn: the fake API runs in this process, a sync spawn would deadlock it
  const child = spawn(process.execPath, [join(root, "infra/site/scripts/cli.ts"), command], {
    cwd: root,
    env: { PATH: process.env.PATH, ...env, GITHUB_API_URL: api, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const status = await new Promise((r) => child.on("close", r));
  return { status, stdout, stderr, output: readFileSync(out, "utf8"), summary: readFileSync(summary, "utf8") };
}

const vars = { SITE_PREVIEW_DEPENDABOT: "", SITE_PREVIEW_MODE: "", SITE_WORKERS_SUBDOMAIN: "acme" };
const renamed = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/^SITE_/, `${config.site.name.toUpperCase()}_`), v]));
const workflowRun = (plan) => ({ github: { token: "ght", repository: REPO, ref_name: "main", event: { repository: { default_branch: "main" } } }, vars: renamed(vars), secrets: {}, needs: { plan: { outputs: plan } }, runner: { temp: tmpdir() } });
/** A scheduled run: the payload may have no `repository` (DEFAULT_BRANCH falls back to ref_name). */
const schedule = () => ({ github: { token: "ght", repository: REPO, ref_name: "main", event: {} }, vars: renamed(vars), secrets: {}, needs: {}, steps: { list: { outputs: { orphans: "7 8" } } }, runner: { temp: tmpdir() } });

test("deploy-preview after-deploy runs with its step's env: a draft keeps its preview, a closed PR is destroyed", async () => {
  await withApi(async (api) => {
    const keep = await run("after-deploy", stepEnv("preview", "after", workflowRun({ pr: "7", sha: SHA })).env, api);
    assert.equal(keep.status, 0, keep.stderr + keep.stdout);
    assert.match(keep.output, /^action=keep$/m);
    const gone = await run("after-deploy", stepEnv("preview", "after", workflowRun({ pr: "8", sha: SHA })).env, api);
    assert.equal(gone.status, 0, gone.stderr + gone.stdout);
    assert.match(gone.output, /^action=destroy$/m);
  });
});

test("deploy-preview pr-check runs with its step's env (BOT_PREVIEWS mapped: an opt-in is honoured)", async () => {
  await withApi(async (api) => {
    const draft = await run("pr-check", stepEnv("preview", "before", workflowRun({ pr: "7", sha: SHA })).env, api);
    assert.equal(draft.status, 0, draft.stderr + draft.stdout);
    assert.match(draft.output, /^deploy=true$/m);
    const ctx = workflowRun({ pr: "9", sha: SHA });
    ctx.vars[`${config.site.name.toUpperCase()}_PREVIEW_DEPENDABOT`] = "true";
    const bot = await run("pr-check", stepEnv("preview", "before", ctx).env, api);
    assert.match(bot.output, /^deploy=true$/m, bot.stderr + bot.stdout);
  });
});

test("sweep orphan-check + sweep-report run with the destroy step's env on a SCHEDULE (no event.repository)", async () => {
  await withApi(async (api) => {
    const { env, run: script } = stepEnv("sweep", "destroy", schedule());
    assert.equal(env.DEFAULT_BRANCH, "main");
    for (const [n, want] of [["7", "false"], ["8", "true"]]) {
      const r = await run("orphan-check", { ...env, PR_NUMBER: n }, api); // PR_NUMBER is exported by the loop
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.output, new RegExp(`^orphan=${want}$`, "m"));
    }
    assert.match(script, /export PR_NUMBER=/);
    const report = await run("sweep-report", { ...env, PR_NUMBER: "8", RESULT: "failed" }, api);
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.summary, /- #8: failed \(retried by the next sweep\)/);
  });
});

test("a step that does not map a required name stops before any side effect, naming it", async () => {
  await withApi(async (api) => {
    const { env } = stepEnv("preview", "after", workflowRun({ pr: "7", sha: SHA }));
    delete env.DEFAULT_BRANCH;
    const r = await run("after-deploy", env, api);
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /does not map DEFAULT_BRANCH/);
  });
});
