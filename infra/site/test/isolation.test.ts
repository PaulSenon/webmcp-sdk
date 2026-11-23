// Isolation preflight (ported from webmcp-sdk infra/docs/test/pipeline.test.ts @52311db, generalised).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isMainOnly, isolationDecision, probeStateStore, storeDecision, type IsolationInput } from "../src/isolation.ts";

const mainOnly = { reviewers: 0, mainOnly: true };
const open = { reviewers: 0, mainOnly: false };

test("production: Worker must exist for the scoped token; environment must be guarded", () => {
  const prod: IsolationInput = { stage: "production", mode: "dynamic", target: "present", production: undefined, protection: mainOnly };
  assert.deepEqual(isolationDecision(prod), { ok: true, notes: [] });
  assert.match((isolationDecision({ ...prod, target: "absent" }) as { reason: string }).reason, /bootstrap/);
  assert.match((isolationDecision({ ...prod, protection: open }) as { reason: string }).reason, /default branch/);
  assert.equal(isolationDecision({ ...prod, protection: { reviewers: 1, mainOnly: false } }).ok, true);
});

test("staging: scoped token that can also see production is noted; mode must match", () => {
  const base: IsolationInput = { stage: "staging", mode: "staging", target: "present", production: "forbidden", protection: mainOnly };
  assert.deepEqual(isolationDecision(base), { ok: true, notes: [], warnings: [] });
  const broad = isolationDecision({ ...base, production: "present" });
  assert.equal(broad.ok, true);
  assert.match((broad as { notes: string[] }).notes[0]!, /reach the production Worker/);
  assert.equal(isolationDecision({ ...base, mode: "dynamic" }).ok, false);
  assert.equal(isolationDecision({ ...base, target: "forbidden" }).ok, false);
});

test("dynamic previews: account-wide token accepted only behind a default-branch-only environment (D13)", () => {
  const dyn: IsolationInput = { stage: "pr-7", mode: "dynamic", target: "absent", production: "present", protection: mainOnly };
  const r = isolationDecision(dyn);
  assert.equal(r.ok, true);
  assert.match((r as { notes: string[] }).notes.join(), /default branch/);
  assert.equal(isolationDecision({ ...dyn, protection: open }).ok, false);
  // a reviewer is not the barrier of an automatic preview: refused without main-only…
  assert.match((isolationDecision({ ...dyn, protection: { reviewers: 1, mainOnly: false } }) as { reason: string }).reason, /default branch only/);
  // …and policy drift (warned, never refused: cleanup must not be blocked) with it
  const drift = isolationDecision({ ...dyn, protection: { reviewers: 1, mainOnly: true } });
  assert.equal(drift.ok, true);
  assert.match((drift as { warnings: string[] }).warnings.join(), /policy drift \(D13\)/);
  assert.deepEqual((r as { warnings: string[] }).warnings, []);
  assert.equal(isolationDecision({ ...dyn, mode: "staging" }).ok, false);
  assert.equal(isolationDecision({ ...dyn, stage: "alice" }).ok, false);
});

test("isMainOnly: exactly the default branch, nothing else", () => {
  const custom = { protected_branches: false, custom_branch_policies: true };
  assert.equal(isMainOnly(custom, [{ name: "main", type: "branch" }]), true);
  assert.equal(isMainOnly(custom, [{ name: "trunk", type: "branch" }], "trunk"), true);
  assert.equal(isMainOnly(custom, [{ name: "main", type: "branch" }, { name: "refs/pull/*/merge", type: "branch" }]), false);
  assert.equal(isMainOnly(custom, [{ name: "main", type: "tag" }]), false);
  assert.equal(isMainOnly({ protected_branches: true, custom_branch_policies: false }, []), false);
  assert.equal(isMainOnly(null, []), false);
});

test("state store: wrong token or wrong API version refused; token never echoed", async () => {
  const fake = (status: number, version?: number) => (async (url: string) => (url.endsWith("/version") ? new Response(JSON.stringify({ version }), { status: 200 }) : new Response("", { status }))) as unknown as typeof fetch;
  assert.deepEqual(storeDecision(await probeStateStore("https://s.x.workers.dev", "t".repeat(20), fake(200, 5)), 5, "s"), { ok: true, notes: [] });
  assert.match((storeDecision(await probeStateStore("https://s.x.workers.dev", "t".repeat(20), fake(401, 5)), 5, "s") as { reason: string }).reason, /not the token/);
  assert.match((storeDecision(await probeStateStore("https://s.x.workers.dev", "t".repeat(20), fake(200, 4)), 5, "s") as { reason: string }).reason, /v4/);
  const secret = "s3cr3t-token-value-xyz";
  await assert.rejects(probeStateStore("https://s.x.workers.dev", secret, (async () => { throw new Error(`boom ${secret}`); }) as unknown as typeof fetch), (e: Error) => !e.message.includes(secret));
});
