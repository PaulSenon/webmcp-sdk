// Lifecycle scenario of the fixture monorepo, without credentials: a fake GitHub (PR states, runs)
// and a fake Cloudflare (Workers by name) driven by the SAME pure decisions site-deploy.yml calls,
// in the same order: plan (pickPr over several lookups + planFromRun) -> re-check (previewAction)
// -> deploy -> after-deploy. Covers drafts (deployed, D13), out-of-order completions, red/cancelled
// builds, close during a deploy, reopen, merge, forks and bots (said in the comment), foreign
// workflows with the same name, ambiguous PRs, staging mode, orphans, production freshness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pickPr, planFromRun, type PrInfo, type RunInfo } from "../src/deploy-plan.ts";
import { afterDeploy, isOrphan, previewAction, previewNumbers, previewNumbersFromState, sweepDecision, SWEEP_GRACE_MINUTES } from "../src/preview.ts";
import { workerName } from "../src/stage.ts";

const REPO = "acme/site";
const BASE = "example-site";
const PATH = ".github/workflows/site.yml";
const sha = (n: number) => n.toString(16).padStart(40, "0");
const ctx = (botPreviews: boolean) => ({ repo: REPO, defaultBranch: "main", botPreviews });

class World {
  prs = new Map<number, PrInfo>();
  workers = new Map<string, string>(); // Worker name -> deployed SHA
  main = sha(0);
  botPreviews = false;
  readonly mode: "dynamic" | "staging";
  constructor(mode: "dynamic" | "staging" = "dynamic") {
    this.mode = mode;
  }

  open(n: number, s: string, opts: { draft?: boolean; fork?: boolean; bot?: boolean } = {}) {
    this.prs.set(n, { number: n, state: "open", draft: !!opts.draft, head: { sha: s, ref: `feature-${n}`, repo: { full_name: opts.fork ? "mallory/site" : REPO } }, base: { ref: "main", repo: { full_name: REPO } }, user: { login: opts.bot ? "dependabot[bot]" : "alice" } });
  }
  pr(n: number) {
    return this.prs.get(n)!;
  }
  /** A completed `site` run, as GET /actions/runs/{id} returns it. */
  run(n: number | undefined, s: string, conclusion = "success", extra: Partial<RunInfo> = {}): RunInfo {
    const pr = n === undefined ? undefined : this.prs.get(n);
    return {
      id: 1,
      event: n === undefined ? "push" : "pull_request",
      conclusion,
      head_sha: s,
      head_branch: n === undefined ? "main" : `feature-${n}`,
      path: PATH,
      head_repository: { full_name: pr?.head.repo?.full_name ?? REPO, owner: { login: (pr?.head.repo?.full_name ?? REPO).split("/")[0] } },
      pull_requests: pr && pr.head.repo?.full_name === REPO ? [{ number: n! }] : [],
      ...extra,
    };
  }

  /** site-deploy.yml for one completed run; `during` runs while Alchemy deploys. */
  /** Comment notices the plan asked for (deploy-comment job), in order. */
  notices: string[] = [];
  handle(run: RunInfo, during?: () => void, trigger: "requested" | "completed" = "completed"): string {
    // cli.ts plan: payload hint + commit lookup (same repo) + branch lookup (also forks, to say so)
    const candidates = run.event === "pull_request"
      ? [...(run.pull_requests ?? []).map((p) => this.prs.get(p.number)).filter((p): p is PrInfo => !!p), ...[...this.prs.values()].filter((p) => p.head.ref === run.head_branch || p.head.sha === run.head_sha)]
      : [];
    let pr: PrInfo | undefined;
    try {
      pr = pickPr(candidates, run, REPO);
    } catch (e) {
      return `fail: ${(e as Error).message}`;
    }
    const plan = planFromRun({ run, trigger, repo: REPO, defaultBranch: "main", workflowPath: PATH, previews: true, pr, mode: this.mode, botPreviews: this.botPreviews, mainHead: run.event === "push" ? this.main : undefined });
    if ("notice" in plan && plan.notice) this.notices.push(`#${"pr" in plan ? plan.pr : "?"} ${plan.notice}`);
    if (plan.action === "skip") return `skip: ${plan.reason}`;
    if (plan.action === "deploy-production") {
      this.workers.set(BASE, run.head_sha);
      return "production";
    }
    if (plan.action === "teardown-preview") {
      // In real life a sweep destroying the same stage concurrently races this destroy (two
      // alchemy destroys of one stage); here: the teardown must still find what it removes.
      if (this.raceCheck && !this.workers.has(workerName(BASE, plan.stage)) && this.everDeployed.has(plan.pr)) return `teardown: RACED by a sweep`;
      this.workers.delete(workerName(BASE, plan.stage));
      return `teardown: ${plan.reason}`;
    }
    if (previewAction(this.pr(plan.pr), run.head_sha, "success", ctx(this.botPreviews)).action !== "deploy") return "skip: re-check";
    this.workers.set(workerName(BASE, plan.stage), run.head_sha);
    this.everDeployed.add(plan.pr);
    during?.();
    if (afterDeploy(this.prs.get(plan.pr) as never, ctx(this.botPreviews)) === "destroy") {
      this.workers.delete(workerName(BASE, plan.stage));
      return "destroyed-after-deploy";
    }
    return "deployed";
  }

  raceCheck = false;
  everDeployed = new Set<number>();
  /** Fake clock (ms) for closed_at and the sweep's grace. */
  now = Date.parse("2026-11-24T00:00:00Z");
  close(n: number) {
    this.pr(n).state = "closed";
    (this.pr(n) as PrInfo & { closed_at?: string }).closed_at = new Date(this.now).toISOString();
  }
  /** cron / manual sweep: long after any close (no grace applies) unless `now` is given. */
  sweep(now = this.now + 24 * 3600_000) {
    for (const n of previewNumbers(BASE, [...this.workers.keys()])) {
      assert.equal(isOrphan(this.prs.get(n) as never, ctx(this.botPreviews)), sweepDecision(this.prs.get(n) as never, ctx(this.botPreviews), Number.MAX_SAFE_INTEGER) === "remove");
      if (sweepDecision(this.prs.get(n) as never, ctx(this.botPreviews), now) === "remove") this.workers.delete(workerName(BASE, `pr-${n}`));
    }
  }
  preview(n: number) {
    return this.workers.get(workerName(BASE, `pr-${n}`));
  }
}

test("drafts get a preview like any open PR (D13); ready_for_review changes nothing", () => {
  const w = new World();
  w.open(1, sha(1), { draft: true });
  assert.equal(w.handle(w.run(1, sha(1)), undefined, "requested"), "skip: build started");
  assert.equal(w.handle(w.run(1, sha(1))), "deployed");
  assert.deepEqual(w.notices, ["#1 building", "#1 deploying"]);
  w.pr(1).draft = false;
  assert.equal(w.preview(1), sha(1));
  w.sweep();
  assert.equal(w.preview(1), sha(1));
});

test("out-of-order completions: the newest head wins, never an older commit", () => {
  const w = new World();
  w.open(2, sha(1));
  w.handle(w.run(2, sha(1)));
  w.pr(2).head.sha = sha(2);
  const run2 = w.run(2, sha(2));
  w.pr(2).head.sha = sha(3);
  assert.equal(w.handle(w.run(2, sha(3))), "deployed");
  assert.match(w.handle(run2), /^skip: no PR has this commit/);
  assert.equal(w.preview(2), sha(3));
});

test("a red or cancelled build never deploys; the preview keeps the last green commit", () => {
  const w = new World();
  w.open(3, sha(1));
  w.handle(w.run(3, sha(1)));
  w.pr(3).head.sha = sha(2);
  assert.equal(w.handle(w.run(3, sha(2), "failure")), "skip: build failure");
  assert.equal(w.handle(w.run(3, sha(2), "cancelled")), "skip: build cancelled");
  assert.equal(w.preview(3), sha(1));
});

test("convert to draft keeps the preview; a draft is never an orphan", () => {
  const w = new World();
  w.open(4, sha(1));
  w.handle(w.run(4, sha(1)));
  w.pr(4).draft = true;
  w.sweep();
  assert.equal(w.preview(4), sha(1));
  w.pr(4).head.sha = sha(2);
  assert.equal(w.handle(w.run(4, sha(2))), "deployed");
  assert.equal(w.preview(4), sha(2));
});

test("closing tears down whatever the closed run concluded (cleanup never depends on the build)", () => {
  const w = new World();
  w.open(14, sha(1));
  w.handle(w.run(14, sha(1)));
  w.pr(14).state = "closed";
  assert.equal(w.handle(w.run(14, sha(1), "failure")), "teardown: PR closed");
  w.open(15, sha(2));
  w.handle(w.run(15, sha(2)));
  w.pr(15).state = "closed";
  assert.equal(w.handle(w.run(15, sha(2)), undefined, "requested"), "skip: PR closed"); // only on completion
  // the closed run never arrived (Actions outage, disabled workflow): the hourly sweep removes it
  w.sweep();
  assert.equal(w.preview(15), undefined);
});

test("a red build says so in the comment; cancelled stays silent (a newer run follows)", () => {
  const w = new World();
  w.open(16, sha(1));
  w.handle(w.run(16, sha(1), "failure"));
  w.handle(w.run(16, sha(1), "cancelled"));
  assert.deepEqual(w.notices, ["#16 build-failed"]);
});

test("closed while the deploy runs: destroyed right after", () => {
  const w = new World();
  w.open(5, sha(1));
  assert.equal(w.handle(w.run(5, sha(1)), () => (w.pr(5).state = "closed")), "destroyed-after-deploy");
  assert.equal(w.preview(5), undefined);
});

test("reopen redeploys; merge (empty payload) tears down; production only at the head of main", () => {
  const w = new World();
  w.open(6, sha(1));
  w.handle(w.run(6, sha(1)));
  w.pr(6).state = "closed";
  assert.equal(w.handle(w.run(6, sha(1))), "teardown: PR closed");
  w.pr(6).state = "open";
  assert.equal(w.handle(w.run(6, sha(1))), "deployed");
  w.pr(6).state = "closed"; // merged
  assert.equal(w.handle(w.run(6, sha(1), "success", { pull_requests: [] })), "teardown: PR closed");
  w.main = sha(7);
  assert.equal(w.handle(w.run(undefined, sha(7))), "production");
  assert.match(w.handle(w.run(undefined, sha(6))), /superseded/);
  assert.equal(w.handle(w.run(undefined, sha(8), "failure")), "skip: build failure");
  assert.equal(w.workers.get(BASE), sha(7));
});

test("forks never deploy and the comment says so once; Dependabot only when opted in", () => {
  const w = new World();
  w.open(8, sha(1), { fork: true });
  assert.match(w.handle(w.run(8, sha(1)), undefined, "requested"), /fork/);
  assert.match(w.handle(w.run(8, sha(1))), /fork/);
  const forged = w.run(8, sha(1), "success", { head_repository: { full_name: REPO }, pull_requests: [{ number: 8 }] });
  assert.match(w.handle(forged), /^skip: no PR has this commit/);
  w.open(9, sha(2), { bot: true });
  assert.match(w.handle(w.run(9, sha(2)), undefined, "requested"), /build only/);
  assert.match(w.handle(w.run(9, sha(2))), /build only/);
  assert.deepEqual(w.notices, ["#8 not-deployed-fork", "#9 not-deployed-bot"]);
  w.botPreviews = true;
  assert.equal(w.handle(w.run(9, sha(2))), "deployed");
  assert.equal(w.workers.size, 1);
  w.botPreviews = false; // opt-in withdrawn: the sweep removes the bot preview
  w.sweep();
  assert.equal(w.workers.size, 0);
});

test("a PR retargeted away from the default branch loses its preview (plan skips, sweep removes)", () => {
  const w = new World();
  w.open(17, sha(1));
  w.handle(w.run(17, sha(1)));
  w.pr(17).base.ref = "next";
  assert.match(w.handle(w.run(17, sha(1))), /targets next/);
  w.sweep();
  assert.equal(w.preview(17), undefined);
});

test("foreign workflows, other branches, ambiguous PRs never deploy", () => {
  const w = new World();
  w.open(10, sha(4));
  assert.match(w.handle(w.run(10, sha(4), "success", { path: ".github/workflows/evil.yml" })), /not \.github\/workflows\/site\.yml/);
  assert.match(w.handle({ ...w.run(undefined, sha(1)), head_branch: "next" }), /not main/);
  w.open(20, sha(5));
  w.open(21, sha(5));
  assert.match(w.handle(w.run(20, sha(5))), /^fail: .*several PRs/);
});

test("staging mode: every PR deploys to the one staging Worker; nothing is torn down", () => {
  const w = new World("staging");
  w.open(30, sha(1));
  w.open(31, sha(2));
  w.handle(w.run(30, sha(1)));
  w.handle(w.run(31, sha(2)));
  assert.equal(w.workers.get(`${BASE}-staging`), sha(2));
  w.pr(31).state = "closed";
  assert.match(w.handle(w.run(31, sha(2))), /staging is shared/);
  assert.equal(w.workers.size, 1);
});

test("sweep removes orphans and keeps live previews and other Workers", () => {
  const w = new World();
  w.open(40, sha(1));
  w.open(41, sha(2));
  w.handle(w.run(40, sha(1)));
  w.handle(w.run(41, sha(2)));
  w.pr(40).state = "closed";
  w.workers.set(workerName(BASE, "pr-42"), sha(3));
  w.workers.set("unrelated-worker-pr-1", sha(4));
  w.workers.set(BASE, sha(0));
  w.sweep();
  assert.deepEqual([...w.workers.keys()].sort(), ["example-site", "example-site-pr-41", "unrelated-worker-pr-1"]);
});

test("sweep scope: only <worker>-pr-<n> Workers and pr-<n> stages, never anything else", () => {
  const names = [
    BASE, `${BASE}-staging`, `${BASE}-state`, `${BASE}-preview-state`, `${BASE}-pr-state`, `${BASE}-pr-0`, `${BASE}-pr-01`,
    `${BASE}-pr-1-x`, `${BASE}-pr-`, `${BASE}-pr-12345678`, `other-${BASE}-pr-3`, `${BASE}x-pr-4`, "unrelated-worker-pr-1", `${BASE}-PR-5`, ` ${BASE}-pr-6`,
  ];
  assert.deepEqual(previewNumbers(BASE, names), []);
  assert.deepEqual(previewNumbers(BASE, [...names, `${BASE}-pr-7`, `${BASE}-pr-1234567`]), [7, 1234567]);
  const stack = "example-site";
  const listing = ["production/", "staging/", "prod/", "pr-0/", "pr-01/", "pr-8/x/", "other/pr-9/", `${stack}/production/`, "pr-10", `${stack}/pr-11/`].join("\n");
  assert.deepEqual(previewNumbersFromState(listing, stack), [10, 11]);
});

test("state list: captured beta.85 output — the stack listing yields its pr-<n> stages, the root yields none (v0.4.1)", () => {
  const read = (f: string) => readFileSync(new URL(`fixtures/state-list/${f}`, import.meta.url), "utf8");
  assert.deepEqual(previewNumbersFromState(read("stack.txt"), "example-site"), [6, 16]);
  assert.deepEqual(previewNumbersFromState(read("root.txt"), "example-site"), []); // why v0.4.0 saw `state []`
});

test("event-driven sweep (v0.4.2): running it around every deploy/teardown changes no outcome", () => {
  const story = (w: World, sweepNow: boolean) => {
    const out: string[] = [];
    const step = (r: () => string) => {
      if (sweepNow) w.sweep(w.now); // the sweep job of the same run, or of another, right now
      out.push(r());
      if (sweepNow) w.sweep(w.now);
      w.now += 60_000;
    };
    w.open(50, sha(1));
    w.open(51, sha(2), { draft: true });
    step(() => w.handle(w.run(50, sha(1))));
    step(() => w.handle(w.run(51, sha(2))));
    w.close(50);
    step(() => w.handle(w.run(50, sha(1)))); // teardown of a PR closed just now: the sweep defers
    w.pr(51).head.sha = sha(3);
    step(() => w.handle(w.run(51, sha(3)), () => w.close(51))); // closed during the deploy
    w.pr(50).state = "open"; // reopened
    step(() => w.handle(w.run(50, sha(1))));
    return { out, workers: [...w.workers.entries()].sort() };
  };
  const raced = (w: World) => ((w.raceCheck = true), w);
  const withSweep = story(raced(new World()), true);
  assert.deepEqual(withSweep, story(raced(new World()), false));
  assert.ok(!withSweep.out.some((o) => o.includes("RACED")));
  // without the grace the same story races the teardown: the grace is what keeps outcomes equal
  const noGrace = new World();
  raced(noGrace).sweep = function (this: World) {
    World.prototype.sweep.call(this, Number.MAX_SAFE_INTEGER);
  };
  assert.ok(story(noGrace, true).out.some((o) => o.includes("RACED")));
});

test("sweep grace: a PR closed < 15 min ago is left to its teardown, then removed", () => {
  const w = new World();
  w.open(52, sha(1));
  w.handle(w.run(52, sha(1)));
  w.close(52); // its closed run never arrives
  w.sweep(w.now + (SWEEP_GRACE_MINUTES - 1) * 60_000);
  assert.equal(w.preview(52), sha(1));
  w.sweep(w.now + SWEEP_GRACE_MINUTES * 60_000);
  assert.equal(w.preview(52), undefined);
  // gone / fork / closed without closed_at: no grace
  const c = { repo: REPO, defaultBranch: "main", botPreviews: false };
  assert.equal(sweepDecision(undefined, c, w.now), "remove");
  assert.equal(sweepDecision({ ...w.pr(52), closed_at: null } as never, c, w.now), "remove");
});
