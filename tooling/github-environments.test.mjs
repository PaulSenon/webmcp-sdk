import assert from "node:assert/strict";
import { test } from "node:test";
import { environmentPlan } from "./github-environments.mjs";

const base = { site: "docs", defaultBranch: "main", releaseBranches: ["main", "next"], releaseMode: "stage", reviewerId: 42, flags: [] };
const policy = { protected_branches: false, custom_branch_policies: true };
const none = { deployment_branch_policy: policy, reviewers: [] };
const one = { deployment_branch_policy: policy, reviewers: [{ type: "User", id: 42 }], prevent_self_review: false };
const byName = (plan) => Object.fromEntries(plan.map((e) => [e.name, e]));

test("default (stage mode): exact PUT bodies — reviewers: [] wherever no reviewer is wanted", () => {
  assert.deepEqual(environmentPlan(base), [
    { name: "docs-preview", branches: ["main"], body: none },
    { name: "docs-production", branches: ["main"], body: none },
    { name: "npm-release", branches: ["main", "next"], body: none },
    { name: "release-finalize", branches: ["main", "next"], body: one },
  ]);
});

test("previews are automatic (D13): --preview-reviewer is refused; --production-reviewer touches production only", () => {
  assert.throws(() => environmentPlan({ ...base, flags: ["--preview-reviewer"] }), /automatic/);
  const q = byName(environmentPlan({ ...base, flags: ["--production-reviewer", "--npm-release-reviewer"] }));
  assert.deepEqual(q["docs-preview"].body, none);
  assert.deepEqual(q["docs-production"].body, one);
});

test("re-running without a flag actively removes the reviewer (GitHub keeps it when the key is absent)", () => {
  for (const env of environmentPlan(base)) {
    if (env.name === "release-finalize") continue;
    assert.ok(Object.hasOwn(env.body, "reviewers"), `${env.name}: the reviewers key must always be sent`);
    assert.deepEqual(env.body.reviewers, []);
  }
});

test("npm-release: no reviewer in stage mode, required in direct mode or with --npm-release-reviewer", () => {
  assert.deepEqual(byName(environmentPlan(base))["npm-release"].body, none);
  assert.deepEqual(byName(environmentPlan({ ...base, releaseMode: "direct" }))["npm-release"].body, one);
  assert.deepEqual(byName(environmentPlan({ ...base, flags: ["--npm-release-reviewer"] }))["npm-release"].body, one);
});
