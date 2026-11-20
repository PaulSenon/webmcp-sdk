// Custom production domain (D12): config validation, the bootstrap decisions, and the bootstrap
// operation against a mock Cloudflare API that records every write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CloudflareClient } from "../src/api.ts";
import { detachDecision, domainDecision, productionUrl, validateSiteDomain, type DomainProbe } from "../src/domain.ts";
import { domainOp } from "../scripts/bootstrap.ts";

const ACCOUNT = "a".repeat(32);
const ZONE = "b".repeat(32);
const domain = { name: "docs.example.com", zoneId: ZONE };
const zone = { id: ZONE, name: "example.com", account: { id: ACCOUNT } };
const WORKER = "example-site";
const free: DomainProbe = { zone, attachments: [], dnsRecords: [] };

test("config: site.domain validation", () => {
  assert.equal(validateSiteDomain(undefined), undefined);
  assert.deepEqual(validateSiteDomain(domain), domain);
  for (const [bad, why] of [
    [{ name: "Docs.Example.com", zoneId: ZONE }, /lowercase/],
    [{ name: "*.example.com", zoneId: ZONE }, /lowercase hostname|wildcard/],
    [{ name: "example.com", zoneId: ZONE }, /apex/],
    [{ name: "docs.example.com", zoneId: "nope" }, /32-hex/],
    [{ name: "docs.example.com" }, /exactly name and zoneId/],
    [{ name: "docs.example.com", zoneId: ZONE, override: true }, /exactly name and zoneId/],
    [{ name: "x.acme.workers.dev", zoneId: ZONE }, /workers\.dev/],
    [{ name: "docs.example.com.", zoneId: ZONE }, /lowercase hostname/],
  ] as const) {
    assert.throws(() => validateSiteDomain(bad), why, JSON.stringify(bad));
  }
});

test("production URL uses the domain; previews never do (they use workersDevUrl directly)", () => {
  assert.equal(productionUrl(domain, "https://example-site.acme.workers.dev/"), "https://docs.example.com/");
  assert.equal(productionUrl(undefined, "https://example-site.acme.workers.dev/"), "https://example-site.acme.workers.dev/");
});

test("decision: free / ours / other Worker / DNS record / wrong account / apex / outside zone", () => {
  const d = (probe: DomainProbe, dom = domain) => domainDecision({ domain: dom, accountId: ACCOUNT, worker: WORKER, probe });
  assert.deepEqual(d(free), { action: "attach" });
  const ours = { id: "att1", hostname: domain.name, service: WORKER, zone_id: ZONE };
  // our own attachment's DNS record does not count against us
  assert.deepEqual(d({ ...free, attachments: [ours], dnsRecords: [{ type: "AAAA", name: domain.name, content: "100::" }] }), { action: "already", id: "att1" });
  assert.match((d({ ...free, attachments: [{ ...ours, service: "other-app" }] }) as { reason: string }).reason, /attached to Worker other-app/);
  assert.match((d({ ...free, dnsRecords: [{ type: "CNAME", name: domain.name, content: "elsewhere.net" }] }) as { reason: string }).reason, /DNS record\(s\): CNAME elsewhere\.net/);
  assert.deepEqual(d({ ...free, dnsRecords: [{ type: "A", name: "other.example.com", content: "1.2.3.4" }] }), { action: "attach" }); // other names ignored
  assert.match((d({ ...free, zone: { ...zone, account: { id: "c".repeat(32) } } }) as { reason: string }).reason, /belongs to account/);
  assert.match((d(free, { name: "example.com", zoneId: ZONE }) as { reason: string }).reason, /apex/);
  assert.match((d(free, { name: "docs.other.org", zoneId: ZONE }) as { reason: string }).reason, /not inside zone/);
  assert.match((d(free, { name: "evilexample.com.x", zoneId: ZONE }) as { reason: string }).reason, /not inside zone/);
  assert.match((d({ ...free, zone: undefined }) as { reason: string }).reason, /not visible/);
  assert.match((d({ ...free, attachments: [{ ...ours, zone_id: "d".repeat(32) }] }) as { reason: string }).reason, /in zone/);
});

test("detach decision: only this Worker's attachment", () => {
  const d = (probe: DomainProbe) => detachDecision({ domain, accountId: ACCOUNT, worker: WORKER, probe });
  assert.deepEqual(d(free), { action: "absent" });
  assert.deepEqual(d({ ...free, attachments: [{ id: "att1", hostname: domain.name, service: WORKER }] }), { action: "detach", id: "att1" });
  assert.equal(d({ ...free, attachments: [{ id: "x", hostname: domain.name, service: "other-app" }] }).action, "stop");
});

/** Mock Cloudflare API: serves the probe, records writes, simulates the attachment. */
function mockCf(state: { zone?: typeof zone; attachments: { id: string; hostname: string; service: string; zone_id?: string }[]; dns: { type: string; name: string; content?: string }[] }) {
  const writes: { method: string; path: string; body?: unknown }[] = [];
  const cf: CloudflareClient = {
    async request(method, path, body) {
      const ok = <T>(result: T) => ({ status: 200, body: { success: true, result } as never });
      if (method !== "GET") writes.push({ method, path, body });
      if (method === "GET" && path === `/zones/${ZONE}`) return state.zone ? ok(state.zone) : { status: 404, body: { success: false, result: null } as never };
      if (method === "GET" && path.startsWith(`/accounts/${ACCOUNT}/workers/domains?hostname=`)) return ok(state.attachments);
      if (method === "GET" && path.startsWith(`/zones/${ZONE}/dns_records?name=`)) return ok(state.dns);
      if (method === "PUT" && path === `/accounts/${ACCOUNT}/workers/domains`) {
        const b = body as { hostname: string; service: string; zone_id: string };
        state.attachments.push({ id: "new1", hostname: b.hostname, service: b.service, zone_id: b.zone_id });
        state.dns.push({ type: "AAAA", name: b.hostname, content: "100::" }); // what Cloudflare creates
        return ok({ id: "new1" });
      }
      if (method === "DELETE") {
        state.attachments = state.attachments.filter((a) => !path.endsWith(`/${a.id}`));
        return ok(null);
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return { cf, writes };
}

const quiet = async (fn: () => Promise<unknown>) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test("domainOp: attaches a free hostname with exactly one PUT (no override flag); idempotent; check is read-only", async () => {
  const m = mockCf({ zone, attachments: [], dns: [] });
  await quiet(() => domainOp(m.cf, ACCOUNT, WORKER, domain, { check: true, detach: false }));
  assert.equal(m.writes.length, 0, "--check writes nothing");
  await quiet(() => domainOp(m.cf, ACCOUNT, WORKER, domain, { check: false, detach: false }));
  assert.deepEqual(m.writes, [{ method: "PUT", path: `/accounts/${ACCOUNT}/workers/domains`, body: { hostname: domain.name, service: WORKER, zone_id: ZONE } }]);
  await quiet(() => domainOp(m.cf, ACCOUNT, WORKER, domain, { check: false, detach: false }));
  assert.equal(m.writes.length, 1, "second run: already attached, no write");
});

test("domainOp: stops before any write on another Worker, a DNS record, a wrong account or the apex", async () => {
  for (const state of [
    { zone, attachments: [{ id: "x", hostname: domain.name, service: "other-app" }], dns: [] },
    { zone, attachments: [], dns: [{ type: "CNAME", name: domain.name, content: "elsewhere.net" }] },
    { zone: { ...zone, account: { id: "c".repeat(32) } }, attachments: [], dns: [] },
    { zone: { ...zone, name: "docs.example.com" }, attachments: [], dns: [] },
  ]) {
    const m = mockCf(state);
    await assert.rejects(quiet(() => domainOp(m.cf, ACCOUNT, WORKER, domain, { check: false, detach: false })), /STOP/);
    assert.equal(m.writes.length, 0, JSON.stringify(state));
  }
});

test("domainOp --detach-domain: deletes only this Worker's attachment", async () => {
  const m = mockCf({ zone, attachments: [{ id: "att1", hostname: domain.name, service: WORKER }], dns: [] });
  await quiet(() => domainOp(m.cf, ACCOUNT, WORKER, domain, { check: false, detach: true }));
  assert.deepEqual(m.writes, [{ method: "DELETE", path: `/accounts/${ACCOUNT}/workers/domains/att1`, body: undefined }]);
  const other = mockCf({ zone, attachments: [{ id: "x", hostname: domain.name, service: "other-app" }], dns: [] });
  await assert.rejects(quiet(() => domainOp(other.cf, ACCOUNT, WORKER, domain, { check: false, detach: true })), /not ours/);
  assert.equal(other.writes.length, 0);
});

test("alchemy.run.ts never passes `domain` to the Worker (D12: Alchemy must never manage it)", () => {
  const src = readFileSync(new URL("../alchemy.run.ts", import.meta.url), "utf8");
  const props = src.slice(src.indexOf('Cloudflare.Worker("Site"'));
  assert.ok(props.length > 0);
  assert.doesNotMatch(props, /^\s*domain\s*:/m);
  assert.doesNotMatch(props, /\bdomain\s*:\s*(null|undefined|config)/);
});

// v0.3.3 (Better Upload's real bootstrap): the placeholder must use site.serverEntry.
import { mkdtempSync as mkTmp, existsSync as exists } from "node:fs";
import { tmpdir as tmp } from "node:os";
import { join as pjoin } from "node:path";
import { checkArtifact } from "../src/artifact.ts";
import { loadConfig } from "../src/config.ts";
import { writePlaceholderArtifact } from "../scripts/bootstrap.ts";

test("placeholder artifact passes checkArtifact: static, server (default entry), server (custom entry)", () => {
  const base = loadConfig();
  for (const site of [{ ...base.site, server: false }, { ...base.site, server: true, serverEntry: undefined }, { ...base.site, server: true, serverEntry: "server.js" }]) {
    const cfg = { ...base, site };
    const dir = mkTmp(pjoin(tmp(), "placeholder-"));
    writePlaceholderArtifact(dir, cfg);
    const entry = site.server ? pjoin(dir, "server", site.serverEntry ?? "index.js") : undefined;
    if (entry) assert.ok(exists(entry), entry);
    assert.equal(checkArtifact(dir, { server: site.server, serverEntry: site.serverEntry }).hasServer, site.server);
    if (site.serverEntry === "server.js") assert.ok(!exists(pjoin(dir, "server", "index.js")), "no stray index.js");
  }
});
