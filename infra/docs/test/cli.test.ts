import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/cli.ts", import.meta.url));
const run = (command: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [cli, command], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
const SUB = { SUBDOMAIN: "acme" };
const SHA = "abc1234def5678abc1234def5678abc1234def56";

test("target: production from main, with its own Worker and state store", () => {
  const prod = run("target", SUB);
  assert.equal(prod.status, 0, prod.stderr);
  assert.match(prod.stdout, /^stage=production\nworker=webmcp-sdk-docs\nstore=webmcp-sdk-docs-state\nurl=https:\/\/webmcp-sdk-docs\.acme\.workers\.dev\/\n$/);
  assert.equal(run("target", { ...SUB, GITHUB_REF: "refs/heads/feature" }).status, 1);
});

test("target: PRs go to the shared staging Worker by default, per-PR Workers in dynamic mode", () => {
  const staging = run("target", { ...SUB, PR_NUMBER: "9", SHA });
  assert.equal(staging.status, 0, staging.stderr);
  assert.match(staging.stdout, /stage=staging\nworker=webmcp-sdk-docs-staging\nstore=webmcp-sdk-docs-preview-state\nurl=https:\/\/webmcp-sdk-docs-staging\.acme\.workers\.dev\/\nrevision=pr-9@abc1234\n/);
  const dynamic = run("target", { ...SUB, PR_NUMBER: "9", PREVIEW_MODE: "dynamic" });
  assert.match(dynamic.stdout, /stage=pr-9\nworker=webmcp-sdk-docs-pr-9\nstore=webmcp-sdk-docs-preview-state\n/);
  assert.equal(run("target", { ...SUB, PR_NUMBER: "9", PREVIEW_MODE: "per-pr" }).status, 1);
});

test("target: rejects outputs forged by the build job", () => {
  const forgeries: Array<Record<string, string>> = [
    { BUILD_STAGE: "production" }, // a PR build claiming production
    { BUILD_STAGE: "pr-8", PREVIEW_MODE: "dynamic" }, // another PR's preview
    { BUILD_URL: "https://attacker.example/" }, // smoke test and PR comment would point elsewhere
  ];
  for (const forged of forgeries) {
    const r = run("target", { ...SUB, PR_NUMBER: "9", ...forged });
    assert.equal(r.status, 1, JSON.stringify(forged));
    assert.match(r.stdout + r.stderr, /differs from/);
  }
  assert.equal(run("target", { ...SUB, PR_NUMBER: "9;x" }).status, 1);
  assert.equal(run("target", { SUBDOMAIN: "Bad.Sub" }).status, 1);
});
