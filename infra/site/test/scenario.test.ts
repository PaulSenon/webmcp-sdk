// Lifecycle scenario of the fixture monorepo, without credentials: a fake GitHub (PR states, runs)
// and a fake Cloudflare (Workers by name) driven by the SAME pure decisions site-deploy.yml calls,
// in the same order: plan (pickPr over several lookups + planFromRun) -> re-check (previewAction)
// -> deploy -> after-deploy. Covers draft/ready, out-of-order completions, red/cancelled builds,
// close/draft during a deploy, reopen, merge, forks, bots (opt-in), foreign workflows with the same
// name, ambiguous PRs, staging mode, orphans, production freshness.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPr, planFromRun, type PrInfo, type RunInfo } from "../src/deploy-plan.ts";
import { afterDeploy, isOrphan, previewAction, previewNumbers } from "../src/preview.ts";
import { workerName } from "../src/stage.ts";

const REPO = "acme/site";
const BASE = "example-site";
const PATH = ".github/workflows/site.yml";
const sha = (n: number) => n.toString(16).padStart(40, "0");

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
      head_repository: { full_name: pr?.head.repo?.full_name ?? REPO },
      pull_requests: pr && pr.head.repo?.full_name === REPO ? [{ number: n! }] : [],
      ...extra,
    };
  }

  /** site-deploy.yml for one completed run; `during` runs while Alchemy deploys. */
  handle(run: RunInfo, during?: () => void): string {
    // cli.ts plan: payload hint + branch lookup + commit lookup (all PRs whose head is this SHA)
    const candidates = run.head_repository?.full_name === REPO && run.event === "pull_request"
      ? [...(run.pull_requests ?? []).map((p) => this.prs.get(p.number)).filter((p): p is PrInfo => !!p), ...[...this.prs.values()].filter((p) => p.head.ref === run.head_branch || p.head.sha === run.head_sha)]
      : [];
    let pr: PrInfo | undefined;
    try {
      pr = pickPr(candidates, run, REPO);
    } catch (e) {
      return `fail: ${(e as Error).message}`;
    }
    const plan = planFromRun({ run, repo: REPO, defaultBranch: "main", workflowPath: PATH, previews: true, pr, mode: this.mode, botPreviews: this.botPreviews, mainHead: run.event === "push" ? this.main : undefined });
    if (plan.action === "skip") return `skip: ${plan.reason}`;
    if (plan.action === "deploy-production") {
      this.workers.set(BASE, run.head_sha);
      return "production";
    }
    if (plan.action === "teardown-preview") {
      this.workers.delete(workerName(BASE, plan.stage));
      return `teardown: ${plan.reason}`;
    }
    if (previewAction(this.pr(plan.pr), run.head_sha, "success", { repo: REPO, botPreviews: this.botPreviews }).action !== "deploy") return "skip: re-check";
    this.workers.set(workerName(BASE, plan.stage), run.head_sha);
    during?.();
    if (afterDeploy(this.prs.get(plan.pr) as never) === "destroy") {
      this.workers.delete(workerName(BASE, plan.stage));
      return "destroyed-after-deploy";
    }
    return "deployed";
  }

  sweep() {
    for (const n of previewNumbers(BASE, [...this.workers.keys()])) {
      if (isOrphan(this.prs.get(n) as never, REPO)) this.workers.delete(workerName(BASE, `pr-${n}`));
    }
  }
  preview(n: number) {
    return this.workers.get(workerName(BASE, `pr-${n}`));
  }
}

test("draft PRs get a build but no preview; ready_for_review deploys", () => {
  const w = new World();
  w.open(1, sha(1), { draft: true });
  assert.equal(w.handle(w.run(1, sha(1))), "teardown: PR draft"); // idempotent no-op
  w.pr(1).draft = false;
  assert.equal(w.handle(w.run(1, sha(1))), "deployed");
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
  assert.match(w.handle(run2), /^skip: no same-repository PR has this commit/);
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

test("convert to draft tears down even if that run was cancelled; a late run does not resurrect it", () => {
  const w = new World();
  w.open(4, sha(1));
  w.handle(w.run(4, sha(1)));
  w.pr(4).draft = true;
  assert.equal(w.handle(w.run(4, sha(1), "cancelled")), "teardown: PR draft");
  assert.equal(w.handle(w.run(4, sha(1))), "teardown: PR draft");
  assert.equal(w.preview(4), undefined);
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

test("forks never deploy; Dependabot builds only unless opted in", () => {
  const w = new World();
  w.open(8, sha(1), { fork: true });
  assert.match(w.handle(w.run(8, sha(1))), /fork/);
  const forged = w.run(8, sha(1), "success", { head_repository: { full_name: REPO }, pull_requests: [{ number: 8 }] });
  assert.match(w.handle(forged), /^skip: no same-repository PR/);
  w.open(9, sha(2), { bot: true });
  assert.match(w.handle(w.run(9, sha(2))), /build only/);
  w.botPreviews = true;
  assert.equal(w.handle(w.run(9, sha(2))), "deployed");
  assert.equal(w.workers.size, 1);
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
