// Optional custom domain for the PRODUCTION site (kit decision D12). Pure validation and decisions;
// the Cloudflare probes and the single write call live in scripts/bootstrap.ts (owner op).
//
// The domain is attached by the OWNER through the Workers custom-domains API — never through
// Alchemy and never from CI — so Alchemy's state never records it. With `domain` omitted from
// the Worker props AND absent from state, Alchemy beta.85 makes no custom-domain API call at all
// on deploy, plan or read (WorkerProvider.ts l.994/4184/5220; docs/decisions.md D12): CI tokens
// need no zone permission, and nothing CI runs can attach, move or detach a hostname of the zone.

export interface SiteDomain {
  /** Hostname, lowercase, a strict subdomain of the zone (never the apex in v0). */
  name: string;
  /** The zone's 32-hex id, pinned: no zone lookup by name ever happens. */
  zoneId: string;
}

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);

export function validateSiteDomain(raw: unknown): SiteDomain | undefined {
  if (raw === undefined) return undefined;
  const d = raw as SiteDomain;
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("site.domain must be { name, zoneId }");
  const keys = Object.keys(d).sort().join(",");
  if (keys !== "name,zoneId") throw new Error(`site.domain must have exactly name and zoneId (got ${keys})`);
  if (typeof d.name !== "string" || d.name.length > 253 || !HOSTNAME.test(d.name)) throw new Error(`site.domain.name must be a lowercase hostname, not ${JSON.stringify(d.name)}`);
  if (d.name.includes("*")) throw new Error("site.domain.name: wildcards are not allowed");
  // The apex is refused definitively at bootstrap (against the zone's real name); here, the obvious
  // case: a two-label name can only be an apex (or a public suffix).
  if (d.name.split(".").length < 3) throw new Error(`site.domain.name ${d.name} looks like a zone apex: v0 only supports a subdomain`);
  if (d.name.endsWith(".workers.dev")) throw new Error("site.domain.name: workers.dev is already served without a custom domain");
  if (typeof d.zoneId !== "string" || !/^[0-9a-f]{32}$/.test(d.zoneId)) throw new Error("site.domain.zoneId must be the zone's 32-hex id");
  return d;
}

/** Production URL: the custom domain when set, else workers.dev. Previews never use it. */
export function productionUrl(domain: SiteDomain | undefined, workersDevProductionUrl: string): string {
  return domain ? `https://${domain.name}/` : workersDevProductionUrl;
}

// --- bootstrap decision -------------------------------------------------------------------------

export interface ZoneInfo {
  id: string;
  name: string;
  account: { id: string };
}
export interface DomainAttachment {
  id: string;
  hostname: string;
  service: string;
  zone_id?: string;
}
export interface DnsRecord {
  type: string;
  name: string;
  content?: string;
}
export interface DomainProbe {
  /** GET /zones/{zoneId}; undefined = not found / not visible with this token. */
  zone: ZoneInfo | undefined;
  /** GET /accounts/{id}/workers/domains?hostname=<host> */
  attachments: DomainAttachment[];
  /** GET /zones/{zoneId}/dns_records?name=<host>, all types */
  dnsRecords: DnsRecord[];
}

export type DomainDecision =
  | { action: "attach" }
  | { action: "already"; id: string }
  | { action: "stop"; reason: string };

/** Zone checks shared by attach and detach: right account, a strict subdomain (never the apex). */
function zoneProblem(domain: SiteDomain, accountId: string, zone: ZoneInfo | undefined): string | undefined {
  if (!zone) return `zone ${domain.zoneId} is not visible: wrong id, or the token lacks access to it`;
  if (zone.id !== domain.zoneId) return `zone id mismatch: asked ${domain.zoneId}, got ${zone.id}`;
  if (zone.account.id !== accountId) return `zone ${zone.name} belongs to account ${zone.account.id}, not ${accountId}`;
  if (domain.name === zone.name) return `${domain.name} is the zone apex: v0 only supports a subdomain`;
  if (!domain.name.endsWith(`.${zone.name}`)) return `${domain.name} is not inside zone ${zone.name}`;
  return undefined;
}

/**
 * Attach only into a free hostname: not attached to any other Worker, no DNS record of any type
 * (a record means the hostname serves something else: never overridden). Attached to this Worker
 * already = idempotent success; the DNS record Cloudflare created for that attachment is ours.
 */
export function domainDecision(input: { domain: SiteDomain; accountId: string; worker: string; probe: DomainProbe }): DomainDecision {
  const { domain, accountId, worker, probe } = input;
  const problem = zoneProblem(domain, accountId, probe.zone);
  if (problem) return { action: "stop", reason: problem };
  const mine = probe.attachments.filter((a) => a.hostname === domain.name);
  const other = mine.find((a) => a.service !== worker);
  if (other) return { action: "stop", reason: `${domain.name} is attached to Worker ${other.service}: never moved by the kit` };
  const ours = mine.find((a) => a.service === worker);
  if (ours) {
    if (ours.zone_id && ours.zone_id !== domain.zoneId) return { action: "stop", reason: `${domain.name} is attached to ${worker} in zone ${ours.zone_id}, not ${domain.zoneId}` };
    return { action: "already", id: ours.id };
  }
  const records = probe.dnsRecords.filter((r) => r.name === domain.name);
  if (records.length) {
    return { action: "stop", reason: `${domain.name} already has DNS record(s): ${records.map((r) => `${r.type} ${r.content ?? ""}`.trim()).join(", ")} — never overridden; remove it yourself if it is really unused` };
  }
  return { action: "attach" };
}

export type DetachDecision = { action: "detach"; id: string } | { action: "absent" } | { action: "stop"; reason: string };

/** Detach (explicit owner op) only an attachment of THIS Worker. */
export function detachDecision(input: { domain: SiteDomain; accountId: string; worker: string; probe: DomainProbe }): DetachDecision {
  const { domain, accountId, worker, probe } = input;
  const problem = zoneProblem(domain, accountId, probe.zone);
  if (problem) return { action: "stop", reason: problem };
  const mine = probe.attachments.filter((a) => a.hostname === domain.name);
  const other = mine.find((a) => a.service !== worker);
  if (other) return { action: "stop", reason: `${domain.name} is attached to Worker ${other.service}, not ${worker}: not ours to detach` };
  const ours = mine.find((a) => a.service === worker);
  return ours ? { action: "detach", id: ours.id } : { action: "absent" };
}
