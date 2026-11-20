#!/usr/bin/env node
// One-time npm bootstrap for @senon/webmcp-sdk, run by the maintainer on their own machine.
// npm only lets a trusted publisher be configured on a package that already exists, so the
// package is created once by staging a code-free placeholder (tooling/release/bootstrap/),
// which is then rejected: no bytes of ours are ever published outside CI.
//
//   node tooling/release/bootstrap.mjs check          read-only: npm CLI, login, org role, package state
//   node tooling/release/bootstrap.mjs stage          pack the placeholder and stage it (dist-tag "bootstrap")
//   node tooling/release/bootstrap.mjs reject <id>    reject that stage (2FA); the package stays created
//   node tooling/release/bootstrap.mjs trust          configure the stage-only trusted publisher (2FA)
//   node tooling/release/bootstrap.mjs status         read-only: versions, dist-tags, trust, pending stages
//
// Every npm call goes through one pinned npm CLI (npx), independent of the npm bundled with
// your Node. No token is read or printed; npm prompts for 2FA itself (browser or OTP prompt).
// Runbook: docs/releasing.md §8.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NPM = "npm@11.21.2"; // >= 11.15.0 for `npm stage` and `npm trust`; released 2026-11-04
const PKG = "@senon/webmcp-sdk";
const ORG = "senon";
const TRUST = { file: "release.yml", repo: "PaulSenon/webmcp-sdk", env: "npm-release" };
const here = dirname(fileURLToPath(import.meta.url));

function npm(args, { capture = false } = {}) {
  const r = spawnSync("npx", ["--yes", NPM, ...args], { encoding: "utf8", stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function ok(msg) { console.log(`OK    ${msg}`); }
function fail(msg) { console.error(`STOP  ${msg}`); process.exit(1); }

function packageState() {
  const r = npm(["view", PKG, "versions", "dist-tags", "--json"], { capture: true });
  if (r.status === 0) return { exists: true, data: JSON.parse(r.stdout || "{}") };
  if (/E404/.test(r.stderr + r.stdout)) return { exists: false };
  fail(`could not query the registry:\n${r.stderr}`);
}

function check() {
  const v = npm(["--version"], { capture: true });
  if (v.status !== 0) fail(`cannot run ${NPM} through npx:\n${v.stderr}`);
  ok(`npm CLI ${v.stdout.trim()} (pinned ${NPM})`);
  const who = npm(["whoami"], { capture: true });
  if (who.status !== 0) fail(`not logged in. Run: npx --yes ${NPM} login`);
  const user = who.stdout.trim();
  ok(`logged in as ${user}`);
  const org = npm(["org", "ls", ORG, user, "--json"], { capture: true });
  const role = org.status === 0 ? JSON.parse(org.stdout || "{}")[user] : undefined;
  if (!role) fail(`${user} is not a member of the npm org "${ORG}" (or the org is not yours). See docs/releasing.md §8, "If senon is not yours".`);
  if (role === "developer") console.warn(`WARN  role "${role}" in org ${ORG}: you can publish, but only an owner/admin can manage the org.`);
  ok(`org ${ORG}: role "${role}"`);
  const state = packageState();
  if (!state.exists) ok(`${PKG} does not exist yet: next step is "stage"`);
  else ok(`${PKG} exists: versions ${JSON.stringify(state.data.versions)}, dist-tags ${JSON.stringify(state.data["dist-tags"])}`);
  return { user, state };
}

function stage() {
  const { state } = check();
  if (state.exists) fail(`${PKG} already exists: skip "stage", go to "trust" (or "status").`);
  const out = mkdtempSync(join(tmpdir(), "webmcp-bootstrap-"));
  const pack = npm(["pack", join(here, "bootstrap"), "--pack-destination", out, "--json"], { capture: true });
  if (pack.status !== 0) fail(`npm pack failed:\n${pack.stderr}`);
  const [info] = JSON.parse(pack.stdout);
  const files = info.files.map((f) => f.path).sort();
  if (info.name !== PKG || info.version !== "0.0.0-bootstrap.0" || JSON.stringify(files) !== JSON.stringify(["README.md", "package.json"])) {
    fail(`unexpected placeholder tarball: ${info.name}@${info.version} ${JSON.stringify(files)}`);
  }
  const tgz = join(out, readdirSync(out).find((f) => f.endsWith(".tgz")));
  ok(`placeholder ${info.name}@${info.version}, files ${files.join(", ")}, ${info.integrity}`);
  const r = npm(["stage", "publish", tgz, "--tag", "bootstrap", "--access", "public", "--ignore-scripts"]);
  if (r.status !== 0) fail(`npm stage publish failed (see above). If npm says the package must exist first, follow the fallback in docs/releasing.md §8.`);
  console.log(`\nNext: copy the stage ID printed above, then run:\n  node tooling/release/bootstrap.mjs reject <stage-id>`);
}

function reject(id) {
  if (!id || !/^[\w-]+$/.test(id)) fail("usage: bootstrap.mjs reject <stage-id>");
  const r = npm(["stage", "reject", id]);
  if (r.status !== 0) fail("npm stage reject failed (see above)");
  const state = packageState();
  if (!state.exists) fail(`${PKG} no longer exists after the rejection: follow the fallback in docs/releasing.md §8.`);
  ok(`stage rejected; ${PKG} exists with versions ${JSON.stringify(state.data.versions)}. Next: "trust" (only when ready to release within 2 days).`);
}

function trust() {
  const { state } = check();
  if (!state.exists) fail(`${PKG} does not exist yet: run "stage" then "reject" first.`);
  const r = npm(["trust", "github", PKG, "--file", TRUST.file, "--repo", TRUST.repo, "--env", TRUST.env, "--allow-stage-publish"]);
  if (r.status !== 0) fail("npm trust github failed (see above)");
  status();
}

function status() {
  const state = packageState();
  console.log(state.exists ? JSON.stringify(state.data, null, 2) : `${PKG}: not on the registry`);
  if (!state.exists) return;
  console.log("\nTrusted publisher (expect GitHub, PaulSenon/webmcp-sdk, release.yml, npm-release, stage publish only):");
  npm(["trust", "list", PKG]);
  console.log("\nPending stages:");
  npm(["stage", "list", PKG]);
}

const [cmd, arg] = process.argv.slice(2);
const commands = { check, stage, reject: () => reject(arg), trust, status };
if (!commands[cmd]) { console.error("usage: bootstrap.mjs check|stage|reject <stage-id>|trust|status"); process.exit(2); }
commands[cmd]();
