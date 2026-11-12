import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/cli.ts", import.meta.url));
const run = (command: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [cli, command], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
const subdomains = { PRODUCTION_SUBDOMAIN: "prod", PREVIEW_SUBDOMAIN: "prev" };

test("target: recomputes stage and URL from trusted inputs", () => {
  const prod = run("target", subdomains);
  assert.equal(prod.status, 0);
  assert.match(prod.stdout, /^stage=production\nurl=https:\/\/webmcp-sdk-docs\.prod\.workers\.dev\/\n$/);
  const pr = run("target", { ...subdomains, PR_NUMBER: "9", BUILD_STAGE: "pr-9", BUILD_URL: "https://webmcp-sdk-docs-pr-9.prev.workers.dev/" });
  assert.equal(pr.status, 0, pr.stdout);
});

test("target: rejects outputs forged by the build job", () => {
  const forgeries: Array<Record<string, string>> = [
    { BUILD_STAGE: "pr-8" }, // another PR's preview
    { BUILD_URL: "https://attacker.example/" }, // smoke test and PR comment would point elsewhere
  ];
  for (const forged of forgeries) {
    const r = run("target", { ...subdomains, PR_NUMBER: "9", ...forged });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /differs from/);
  }
  assert.equal(run("target", { ...subdomains, PR_NUMBER: "9;x" }).status, 1);
});
