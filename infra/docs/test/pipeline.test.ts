import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureWorkersSubdomain, getWorkersSubdomain, stateStorePresent, verifyToken } from "../src/account.ts";
import { github, redact, type CloudflareClient } from "../src/api.ts";
import { evaluateChecks, REQUIRED_CHECKS, type CheckRun } from "../src/gate.ts";
import {
  COMMENT_MARKER,
  commentPlan,
  findPreviewComment,
  isOrphan,
  parsePreviewStages,
  previewDecision,
  renderComment,
} from "../src/preview.ts";
import { isolationDecision, probeStateStore, storeDecision, type IsolationInput } from "../src/isolation.ts";
import { findCachedStoreToken, parseArgs, permissionReport, readToken } from "../scripts/bootstrap.ts";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const RUN = "https://github.com/PaulSenon/webmcp-sdk/actions/runs/123";
const run = (id: number, name: string, status: string, conclusion: string | null, slug = "github-actions"): CheckRun => ({
  id,
  name,
  status,
  conclusion,
  app: { slug },
});
const allGreen = () => REQUIRED_CHECKS.map((name, i) => run(i + 1, name, "completed", "success"));

// --- gate ---------------------------------------------------------------------------------------

test("gate: the required list is the one place, and excludes the deploy jobs themselves", () => {
  assert.deepEqual([...REQUIRED_CHECKS], ["checks", "browser", "workflow-lint", "docs", "docs-build"]);
  for (const name of REQUIRED_CHECKS) assert.doesNotMatch(name, /deploy|teardown|comment|sweep/);
});

test("gate: passes only when every required check is green", () => {
  assert.equal(evaluateChecks(allGreen()).state, "pass");
});

test("gate: waits while a check is missing or running", () => {
  const missing = evaluateChecks(allGreen().filter((r) => r.name !== "docs"));
  assert.equal(missing.state, "wait");
  assert.deepEqual(missing.missing, ["docs"]);
  const running = evaluateChecks([...allGreen().filter((r) => r.name !== "browser"), run(99, "browser", "in_progress", null)]);
  assert.equal(running.state, "wait");
  assert.deepEqual(running.pending, ["browser"]);
});

test("gate: fails closed on anything but success, skipped and neutral included", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale"]) {
    const r = evaluateChecks([...allGreen().filter((c) => c.name !== "checks"), run(50, "checks", "completed", conclusion)]);
    assert.equal(r.state, "fail", conclusion);
  }
});

test("gate: the newest run of a name wins (re-runs)", () => {
  const failedThenGreen = [...allGreen().filter((c) => c.name !== "checks"), run(10, "checks", "completed", "failure"), run(20, "checks", "completed", "success")];
  assert.equal(evaluateChecks(failedThenGreen).state, "pass");
  const greenThenFailed = [...allGreen().filter((c) => c.name !== "checks"), run(20, "checks", "completed", "success"), run(30, "checks", "completed", "failure")];
  assert.equal(evaluateChecks(greenThenFailed).state, "fail");
});

test("gate: check runs from another app cannot satisfy it", () => {
  const forged = [...allGreen().filter((c) => c.name !== "browser"), run(70, "browser", "completed", "success", "evil-app")];
  assert.deepEqual(evaluateChecks(forged).missing, ["browser"]);
});

// --- preview decision ---------------------------------------------------------------------------

test("preview: deploys only an open, non-draft PR whose head is the built commit", () => {
  const pr = (state: string, draft: boolean, sha: string) => ({ number: 1, state, draft, head: { sha } });
  assert.deepEqual(previewDecision(pr("open", false, SHA), SHA), { deploy: true });
  assert.deepEqual(previewDecision(pr("closed", false, SHA), SHA), { deploy: false, reason: "closed" });
  assert.deepEqual(previewDecision(pr("open", true, SHA), SHA), { deploy: false, reason: "draft" });
  assert.deepEqual(previewDecision(pr("open", false, OTHER), SHA), { deploy: false, reason: "superseded" });
});

// --- comment ------------------------------------------------------------------------------------

test("comment: one marker comment by github-actions[bot] is found; look-alikes are ignored", () => {
  const comments = [
    { id: 1, body: `${COMMENT_MARKER} copied by a human`, user: { login: "someone" } },
    { id: 2, body: "unrelated", user: { login: "github-actions[bot]" } },
    { id: 3, body: `${COMMENT_MARKER}\nold`, user: { login: "github-actions[bot]" } },
  ];
  assert.equal(findPreviewComment(comments)?.id, 3);
  assert.equal(findPreviewComment(comments.slice(0, 2)), undefined);
});

test("comment: body carries the marker, status, URL, short SHA and run link", () => {
  const body = renderComment({ status: "deployed", sha: SHA, runUrl: RUN, url: "https://webmcp-sdk-docs-pr-5.prev.workers.dev/" });
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /deployed:\*\* https:\/\/webmcp-sdk-docs-pr-5\.prev\.workers\.dev\/ — commit `aaaaaaa` — \[run\]\(https:\/\/github\.com\/PaulSenon\/webmcp-sdk\/actions\/runs\/123\)/);
  assert.match(renderComment({ status: "removed", sha: SHA, runUrl: RUN, reason: "draft" }), /removed\*\* \(the PR is a draft\)/);
  assert.match(renderComment({ status: "failed", sha: SHA, runUrl: RUN }), /failed\*\* for commit `aaaaaaa`/);
});

test("comment: staging comments say which PR and commit staging serves", () => {
  const body = renderComment({ status: "deployed", sha: SHA, runUrl: RUN, url: "https://webmcp-sdk-docs-staging.acme.workers.dev/", target: "staging" });
  assert.match(body, /Staging now serves this PR\*\* at commit `aaaaaaa`: https:\/\/webmcp-sdk-docs-staging\.acme\.workers\.dev\//);
  assert.match(body, /next PR deployed there replaces this one/);
  assert.match(body, /never torn down/);
  assert.throws(() => renderComment({ status: "deployed", sha: SHA, runUrl: RUN, url: "https://webmcp-sdk-docs.acme.workers.dev/" }), /preview URL/);
});

test("comment: refuses values that could inject markdown or links", () => {
  assert.throws(() => renderComment({ status: "deployed", sha: SHA, runUrl: RUN, url: "https://evil.example/" }), /preview URL/);
  assert.throws(() => renderComment({ status: "deployed", sha: "x)[a](b", runUrl: RUN }), /SHA/);
  assert.throws(() => renderComment({ status: "failed", sha: SHA, runUrl: "https://evil.example/actions/runs/1" }), /run URL/);
});

test("comment plan: deploys create, teardowns only update, skipped deploys say nothing", () => {
  assert.deepEqual(commentPlan({ deployResult: "success", deployStatus: "deployed", teardownResult: "" }), { status: "deployed", createIfMissing: true });
  assert.deepEqual(commentPlan({ deployResult: "failure", deployStatus: "", teardownResult: "" }), { status: "failed", createIfMissing: true });
  assert.equal(commentPlan({ deployResult: "success", deployStatus: "skipped", teardownResult: "" }), undefined);
  assert.equal(commentPlan({ deployResult: "skipped", deployStatus: "", teardownResult: "skipped" }), undefined);
  assert.deepEqual(commentPlan({ deployResult: "", deployStatus: "", teardownResult: "success" }), { status: "removed", createIfMissing: false });
  assert.deepEqual(commentPlan({ deployResult: "", deployStatus: "", teardownResult: "failure" }), { status: "removal-failed", createIfMissing: false });
});

// --- sweeper ------------------------------------------------------------------------------------

test("sweeper: reads pr-<n> stages from `alchemy state list` output, nothing else", () => {
  const listing = [
    "WARN: alchemy 2.0.0-beta.87 is available",
    "webmcp-sdk-docs/pr-12/",
    "webmcp-sdk-docs/pr-3/",
    "webmcp-sdk-docs/production/",
    "webmcp-sdk-docs/live_isaac/",
    "webmcp-sdk-docs/pr-01/",
    "webmcp-sdk-docs/pr-4/Site.json",
    "other-stack/pr-9/",
    "pr-7/",
    "",
  ].join("\n");
  assert.deepEqual(parsePreviewStages(listing), [3, 7, 12]);
});

test("sweeper: orphan = closed, draft or deleted PR; open ready PRs are kept", () => {
  assert.equal(isOrphan({ number: 1, state: "open", draft: false, head: { sha: SHA } }), false);
  assert.equal(isOrphan({ number: 1, state: "open", draft: true, head: { sha: SHA } }), true);
  assert.equal(isOrphan({ number: 1, state: "closed", draft: false, head: { sha: SHA } }), true);
  assert.equal(isOrphan(undefined), true);
});

// --- account isolation --------------------------------------------------------------------------

// --- single-account isolation -------------------------------------------------------------------

const base: IsolationInput = { stage: "staging", mode: "staging", target: "present", production: "forbidden", reviewers: 0 };

test("isolation: a staging token scoped to its Worker deploys without approval", () => {
  assert.deepEqual(isolationDecision(base), { ok: true, notes: [] });
});

test("isolation: a staging token that can see production needs a required reviewer", () => {
  const broad = isolationDecision({ ...base, production: "present" });
  assert.equal(broad.ok, false);
  assert.match((broad as { reason: string }).reason, /narrow it, or add a required reviewer/);
  const approved = isolationDecision({ ...base, production: "present", reviewers: 1 });
  assert.equal(approved.ok, true);
});

test("isolation: dynamic mode always needs a required reviewer", () => {
  const dyn: IsolationInput = { stage: "pr-4", mode: "dynamic", target: "absent", production: "present", reviewers: 0 };
  assert.match((isolationDecision(dyn) as { reason: string }).reason, /dynamic needs an account-wide Workers token/);
  assert.equal(isolationDecision({ ...dyn, reviewers: 1 }).ok, true);
  assert.equal(isolationDecision({ ...dyn, production: "forbidden" }).ok, false); // still dynamic
});

test("isolation: stage and mode must agree; production and staging Workers must already exist", () => {
  assert.equal(isolationDecision({ ...base, mode: "dynamic" }).ok, false);
  assert.equal(isolationDecision({ stage: "pr-4", mode: "staging", target: "absent", production: "forbidden", reviewers: 1 }).ok, false);
  assert.equal(isolationDecision({ ...base, target: "absent" }).ok, false);
  assert.equal(isolationDecision({ ...base, target: "forbidden" }).ok, false);
  assert.equal(isolationDecision({ stage: "production", mode: "staging", target: "present", production: undefined, reviewers: 0 }).ok, true);
  assert.equal(isolationDecision({ stage: "production", mode: "staging", target: "absent", production: undefined, reviewers: 0 }).ok, false);
  assert.equal(isolationDecision({ ...base, stage: "live_isaac" }).ok, false);
});

test("state store: the bearer token must be this store's and the version must match", async () => {
  const fake = (status: number, version: number) =>
    (async (url: string | URL | Request) =>
      String(url).endsWith("/version")
        ? new Response(JSON.stringify({ version }), { status: 200 })
        : new Response("[]", { status })) as typeof fetch;
  const ok = await probeStateStore("https://webmcp-sdk-docs-state.acme.workers.dev", TOKEN, fake(200, 5));
  assert.deepEqual(ok, { version: 5, authorized: true });
  assert.equal(storeDecision(ok, 5, "webmcp-sdk-docs-state").ok, true);
  const wrongToken = await probeStateStore("https://x.acme.workers.dev", TOKEN, fake(401, 5));
  assert.match((storeDecision(wrongToken, 5, "s") as { reason: string }).reason, /not the token of s/);
  assert.match((storeDecision({ version: 4, authorized: true }, 5, "s") as { reason: string }).reason, /re-run the bootstrap to upgrade/);
  const broken = (async () => {
    throw new Error(`boom ${TOKEN}`);
  }) as typeof fetch;
  await assert.rejects(probeStateStore("https://x.acme.workers.dev", TOKEN, broken), (e: Error) => !e.message.includes(TOKEN));
});

// --- API clients and account checks -------------------------------------------------------------

const TOKEN = "secret-token-value-123456";

test("redact removes the token from any message", () => {
  assert.equal(redact(`Bearer ${TOKEN} failed: ${TOKEN}`, [TOKEN]), "Bearer *** failed: ***");
});

test("github client: follows pagination on api.github.com only, never echoes the token", async () => {
  const pages: Record<string, { body: unknown; link?: string }> = {
    "https://api.github.com/x?page=1": { body: { check_runs: [1, 2] }, link: '<https://api.github.com/x?page=2>; rel="next"' },
    "https://api.github.com/x?page=2": { body: { check_runs: [3] } },
  };
  const fakeFetch = (async (url: string | URL | Request) => {
    const page = pages[String(url)];
    if (!page) return new Response(`nope ${TOKEN}`, { status: 500 });
    return new Response(JSON.stringify(page.body), { status: 200, headers: page.link ? { link: page.link } : {} });
  }) as typeof fetch;
  const gh = github(TOKEN, { fetch: fakeFetch });
  assert.deepEqual(await gh.list("/x?page=1", "check_runs"), [1, 2, 3]);
  await assert.rejects(gh.get("/missing"), (e: Error) => !e.message.includes(TOKEN) && /500/.test(e.message));
});

function fakeCloudflare(routes: Record<string, { status: number; body: unknown }>): CloudflareClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request(method, path) {
      calls.push(`${method} ${path}`);
      const r = routes[`${method} ${path}`] ?? { status: 404, body: { success: false, errors: [{ code: 7003, message: "not found" }] } };
      return { status: r.status, body: r.body as never };
    },
  };
}
const ACC = "0123456789abcdef0123456789abcdef";

test("account: verifies account tokens first, then user tokens; inactive tokens fail", async () => {
  const userToken = fakeCloudflare({ "GET /user/tokens/verify": { status: 200, body: { success: true, result: { status: "active" } } } });
  assert.equal((await verifyToken(userToken, ACC)).kind, "user");
  const accountToken = fakeCloudflare({ [`GET /accounts/${ACC}/tokens/verify`]: { status: 200, body: { success: true, result: { status: "active", expires_on: "2027-11-13T00:00:00Z" } } } });
  assert.deepEqual(await verifyToken(accountToken, ACC), { kind: "account", status: "active", expiresOn: "2027-11-13T00:00:00Z" });
  const disabled = fakeCloudflare({ [`GET /accounts/${ACC}/tokens/verify`]: { status: 200, body: { success: true, result: { status: "disabled" } } } });
  await assert.rejects(verifyToken(disabled, ACC), /disabled/);
  await assert.rejects(verifyToken(fakeCloudflare({}), ACC), /does not verify/);
  await assert.rejects(verifyToken(fakeCloudflare({}), "nope"), /32 lowercase hex/);
});

test("account: the workers.dev subdomain is created only when missing, never changed", async () => {
  const existing = fakeCloudflare({ [`GET /accounts/${ACC}/workers/subdomain`]: { status: 200, body: { success: true, result: { subdomain: "acme" } } } });
  assert.deepEqual(await ensureWorkersSubdomain(existing, ACC, undefined), { subdomain: "acme", created: false });
  await assert.rejects(ensureWorkersSubdomain(existing, ACC, "other"), /not changing/);
  assert.ok(!existing.calls.some((c) => c.startsWith("PUT")));

  const none = fakeCloudflare({ [`PUT /accounts/${ACC}/workers/subdomain`]: { status: 200, body: { success: true, result: { subdomain: "docs-prev" } } } });
  assert.equal(await getWorkersSubdomain(none, ACC), undefined);
  await assert.rejects(ensureWorkersSubdomain(none, ACC, undefined), /--subdomain/);
  assert.deepEqual(await ensureWorkersSubdomain(none, ACC, "docs-prev"), { subdomain: "docs-prev", created: true });
});

test("account: state store presence; permission errors are not mistaken for absence", async () => {
  const path = `GET /accounts/${ACC}/workers/scripts/webmcp-sdk-docs-state/settings`;
  assert.equal(await stateStorePresent(fakeCloudflare({ [path]: { status: 200, body: { success: true, result: {} } } }), ACC), true);
  assert.equal(await stateStorePresent(fakeCloudflare({}), ACC), false);
  await assert.rejects(stateStorePresent(fakeCloudflare({ [path]: { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } } }), ACC), /403/);
});

// --- bootstrap arguments ------------------------------------------------------------------------

test("bootstrap: the token is only accepted from a file", () => {
  const base = ["--account-id", ACC, "--token-file", "/tmp/t", "--out-dir", "/tmp/o"];
  assert.deepEqual(parseArgs(base), { accountId: ACC, tokenFile: "/tmp/t", outDir: "/tmp/o", check: false });
  assert.throws(() => parseArgs([...base, "--token", "x"]), /only accepted through --token-file/);
  assert.throws(() => parseArgs(["--account-id", "abc", "--token-file", "/t", "--out-dir", "/o"]), /account-id/);
  assert.throws(() => parseArgs(["--account-id", ACC, "--token-file", "/t"]), /--out-dir/);
  assert.throws(() => parseArgs([...base, "--subdomain", "Bad_Name"]), /subdomain/);
  assert.equal(parseArgs([...base, "--subdomain", "acme", "--check"]).subdomain, "acme");
});

test("bootstrap: reads a store's cached bearer token, and names the real Workers in its report", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  try {
    mkdirSync(join(home, ".alchemy/profiles/default/state-stores"), { recursive: true });
    writeFileSync(join(home, ".alchemy/profiles/default/state-stores/cloudflare.json"), JSON.stringify({ stores: { "webmcp-sdk-docs-state": { url: "u", authToken: "bearer-1" } } }));
    assert.equal(findCachedStoreToken(home, "webmcp-sdk-docs-state"), "bearer-1");
    assert.equal(findCachedStoreToken(home, "webmcp-sdk-docs-preview-state"), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const report = permissionReport("acme");
  assert.match(report, /github-docs-production {3}Workers · Specified Workers: webmcp-sdk-docs · Editor/);
  assert.match(report, /github-docs-staging {6}Workers · Specified Workers: webmcp-sdk-docs-staging · Editor/);
  assert.match(report, /no Secrets Store, no zone/);
  assert.match(report, /DOCS_STATE_TOKEN {6}--env docs-preview {4}< <out-dir>\/webmcp-sdk-docs-preview-state\.token/);
});

test("bootstrap: token file holds exactly one token", () => {
  const dir = mkdtempSync(join(tmpdir(), "tok-"));
  try {
    const file = join(dir, "t");
    writeFileSync(file, `${TOKEN}\n`);
    chmodSync(file, 0o600);
    assert.equal(readToken(file), TOKEN);
    writeFileSync(file, `${TOKEN} ${TOKEN}`);
    assert.throws(() => readToken(file), /exactly one token/);
    assert.throws(() => readToken(dir), /regular file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
