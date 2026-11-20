// "An error is never read as absent" (v0.3.2, first real run): every Cloudflare probe, given a 401
// (or 403/500), must STOP with its status — and nothing may be written.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CloudflareClient } from "../src/api.ts";
import { workerAccess as preflightWorkerAccess } from "../src/isolation.ts";
import { domainOp, subdomainOf, workerAccess as bootstrapWorkerAccess } from "../scripts/bootstrap.ts";

const ACCOUNT = "a".repeat(32);
const ZONE = "b".repeat(32);
const domain = { name: "docs.example.com", zoneId: ZONE };
const AUTH = { status: 401, body: { success: false, result: null, errors: [{ code: 10000, message: "Authentication error" }] } };

/** Routes: path prefix -> response. Unlisted GETs fail the test; every non-GET is recorded. */
function mock(routes: Record<string, { status: number; body: unknown }>) {
  const writes: string[] = [];
  const cf: CloudflareClient = {
    async request(method, path) {
      if (method !== "GET") {
        writes.push(`${method} ${path}`);
        return { status: 200, body: { success: true, result: { subdomain: "created" } } as never };
      }
      const hit = Object.keys(routes).find((p) => path.startsWith(p));
      if (!hit) throw new Error(`unexpected GET ${path}`);
      return routes[hit] as never;
    },
  };
  return { cf, writes };
}
const ok = (result: unknown) => ({ status: 200, body: { success: true, result } });
const quiet = async <T>(fn: () => Promise<T>) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test("subdomain: 401/403/500 STOP with the status and codes, in --check AND apply, with no PUT", async () => {
  for (const res of [AUTH, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }, { status: 500, body: undefined }]) {
    for (const check of [true, false]) {
      const m = mock({ [`/accounts/${ACCOUNT}/workers/subdomain`]: res });
      await assert.rejects(quiet(() => subdomainOf(m.cf, ACCOUNT, "wanted", check)), new RegExp(`HTTP ${res.status}.*STOP`));
      assert.deepEqual(m.writes, []);
    }
  }
});

test("subdomain: existing vs absent (success with empty value) → would create / creates once", async () => {
  const existing = mock({ [`/accounts/${ACCOUNT}/workers/subdomain`]: ok({ subdomain: "acme" }) });
  assert.equal(await quiet(() => subdomainOf(existing.cf, ACCOUNT, undefined, false)), "acme");
  await assert.rejects(quiet(() => subdomainOf(existing.cf, ACCOUNT, "other", false)), /never changed/);
  const absent = mock({ [`/accounts/${ACCOUNT}/workers/subdomain`]: ok(null) });
  assert.equal(await quiet(() => subdomainOf(absent.cf, ACCOUNT, "wanted", true)), "wanted");
  assert.deepEqual(absent.writes, [], "--check never creates");
  assert.equal(await quiet(() => subdomainOf(absent.cf, ACCOUNT, "wanted", false)), "created");
  assert.deepEqual(absent.writes, [`PUT /accounts/${ACCOUNT}/workers/subdomain`]);
});

test("workerAccess (bootstrap): 401 throws; only 404 or code 10007 mean absent", async () => {
  const path = `/accounts/${ACCOUNT}/workers/scripts/w/settings`;
  await assert.rejects(bootstrapWorkerAccess(mock({ [path]: AUTH }).cf, ACCOUNT, "w"), /HTTP 401/);
  assert.equal(await bootstrapWorkerAccess(mock({ [path]: { status: 404, body: { success: false, errors: [] } } }).cf, ACCOUNT, "w"), "absent");
  assert.equal(await bootstrapWorkerAccess(mock({ [path]: { status: 400, body: { success: false, errors: [{ code: 10007, message: "workers.api.error.script_not_found" }] } } }).cf, ACCOUNT, "w"), "absent");
  // a message merely containing "not found" with another code is NOT absent
  await assert.rejects(bootstrapWorkerAccess(mock({ [path]: { status: 500, body: { success: false, errors: [{ code: 1, message: "upstream not found" }] } } }).cf, ACCOUNT, "w"), /HTTP 500/);
});

test("workerAccess (CI preflight): 401 throws (a broken token proves nothing); 403 = forbidden; 404 = absent", async () => {
  const path = `/accounts/${ACCOUNT}/workers/scripts/w/settings`;
  await assert.rejects(preflightWorkerAccess(mock({ [path]: AUTH }).cf, ACCOUNT, "w"), /HTTP 401/);
  assert.equal(await preflightWorkerAccess(mock({ [path]: { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } } }).cf, ACCOUNT, "w"), "forbidden");
  assert.equal(await preflightWorkerAccess(mock({ [path]: { status: 404, body: { success: false, errors: [] } } }).cf, ACCOUNT, "w"), "absent");
});

test("domain probes: a 401 on the zone, the attachments or the DNS records STOPS with 0 writes", async () => {
  const zoneOk = ok({ id: ZONE, name: "example.com", account: { id: ACCOUNT } });
  const routes = {
    [`/zones/${ZONE}/dns_records`]: ok([]),
    [`/zones/${ZONE}`]: zoneOk,
    [`/accounts/${ACCOUNT}/workers/domains`]: ok([]),
  };
  for (const [broken, why] of [[`/zones/${ZONE}`, /cannot read zone.*HTTP 401/], [`/accounts/${ACCOUNT}/workers/domains`, /cannot list Worker custom domains: HTTP 401/], [`/zones/${ZONE}/dns_records`, /cannot read DNS records.*HTTP 401/]] as const) {
    for (const opts of [{ check: true, detach: false }, { check: false, detach: false }, { check: false, detach: true }]) {
      // more specific prefixes first so /zones/{id}/dns_records is not served by /zones/{id}
      const m = mock(Object.fromEntries(Object.entries({ ...routes, [broken]: AUTH }).sort((a, b) => b[0].length - a[0].length)));
      await assert.rejects(quiet(() => domainOp(m.cf, ACCOUNT, "example-site", domain, opts)), why);
      assert.deepEqual(m.writes, [], `${broken} ${JSON.stringify(opts)}`);
    }
  }
  // a real 404 zone is "not visible" → STOP via the decision, still 0 writes
  const m = mock(Object.fromEntries(Object.entries({ ...routes, [`/zones/${ZONE}`]: { status: 404, body: { success: false, errors: [{ code: 7003, message: "Could not route" }] } } }).sort((a, b) => b[0].length - a[0].length)));
  await assert.rejects(quiet(() => domainOp(m.cf, ACCOUNT, "example-site", domain, { check: false, detach: false })), /not visible/);
  assert.deepEqual(m.writes, []);
});
