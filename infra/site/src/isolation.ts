// Single-account isolation rules, checked by `cli.ts preflight` before any alchemy call with a
// deploy token. Ported from webmcp-sdk infra/docs/src/isolation.ts + account.ts @52311db (PR #7);
// generalised: Worker names from delivery.config.json, default branch as a parameter.
//
// One Cloudflare account holds every stage (and other projects). Worker names are not a security
// boundary: what a token can touch is decided by its scopes. So the workflow probes what the token
// can actually see and refuses unsafe combinations.
import { ACCOUNT_ID, cfErrors, cfNotFound, redact, type CloudflareClient, type Fetch } from "./api.ts";
import { stageKind } from "./stage.ts";

export type WorkerAccess = "present" | "absent" | "forbidden";

export interface EnvironmentProtection {
  /** Number of required reviewers. */
  reviewers: number;
  /** Deployment branch policy allows the default branch and nothing else (no refs/pull/*, no tags). */
  mainOnly: boolean;
}

export interface IsolationInput {
  stage: string;
  mode: "dynamic" | "staging";
  /** What this token sees of the stage's own Worker. */
  target: WorkerAccess;
  /** What this token sees of the production Worker (only probed for non-production stages). */
  production: WorkerAccess | undefined;
  protection: EnvironmentProtection;
}

export type IsolationResult = { ok: true; notes: string[] } | { ok: false; reason: string };

/** Exactly one custom branch policy, of type branch, named after the default branch. */
export function isMainOnly(policy: { protected_branches?: boolean; custom_branch_policies?: boolean } | null | undefined, rules: readonly { name: string; type?: string }[], defaultBranch = "main"): boolean {
  if (!policy || policy.protected_branches || !policy.custom_branch_policies) return false;
  return rules.length === 1 && rules[0]?.name === defaultBranch && (rules[0].type ?? "branch") === "branch";
}

/** Only code that landed on the default branch (or a human-approved run) may hold the secret. */
export const environmentGuards = (p: EnvironmentProtection) => p.reviewers > 0 || p.mainOnly;

export function isolationDecision(input: IsolationInput): IsolationResult {
  const kind = stageKind(input.stage);
  const notes: string[] = [];
  if (kind === "local") return { ok: false, reason: `local stage ${input.stage} cannot deploy from CI` };
  // Kit rule (stricter than WebMCP, which only requires it when the token reaches production):
  // every deploy environment must be main-only or reviewed, or a PR-defined workflow could use it.
  if (!environmentGuards(input.protection)) {
    return { ok: false, reason: "the job's environment releases its secrets to other refs than the default branch and has no required reviewer: restrict it to the default branch (tooling/setup-github.mjs)" };
  }
  if (kind === "production") {
    // The production token is Editor on its Worker: it can update it, never create it.
    if (input.target !== "present") return { ok: false, reason: `the production Worker is ${input.target} for this token: run the bootstrap (creates it) and scope the token to it` };
    return { ok: true, notes };
  }
  if (kind === "staging" && input.mode !== "staging") return { ok: false, reason: "stage staging is only used in staging preview mode" };
  if (kind === "preview" && input.mode !== "dynamic") return { ok: false, reason: "per-PR stages are only used in dynamic preview mode" };
  if (kind === "staging" && input.target !== "present") return { ok: false, reason: `the staging Worker is ${input.target} for this token: run the bootstrap and scope the token to it` };
  const reachesProduction = input.mode === "dynamic" || input.production === "present";
  if (reachesProduction) {
    const why = [input.protection.mainOnly ? "only releases secrets to the default branch" : "", input.protection.reviewers > 0 ? "requires a reviewer" : ""].filter(Boolean).join(" and ");
    notes.push(`this token can reach the production Worker (and other Workers of the account); accepted because the environment ${why}`);
  }
  return { ok: true, notes };
}

// --- Cloudflare probes (from webmcp-sdk account.ts) ---------------------------------------------

export type TokenKind = "account" | "user";

/** Account-owned tokens verify at /accounts/{id}/tokens/verify, user tokens at /user/tokens/verify. */
export async function verifyToken(cf: CloudflareClient, accountId: string): Promise<{ kind: TokenKind; status: string; expiresOn?: string }> {
  if (!ACCOUNT_ID.test(accountId)) throw new Error("account id must be 32 lowercase hex characters");
  for (const [kind, path] of [["account", `/accounts/${accountId}/tokens/verify`], ["user", "/user/tokens/verify"]] as const) {
    const { body } = await cf.request<{ status: string; expires_on?: string }>("GET", path);
    if (body?.success && body.result?.status) {
      if (body.result.status !== "active") throw new Error(`token status is ${body.result.status}, not active`);
      return { kind, status: body.result.status, ...(body.result.expires_on ? { expiresOn: body.result.expires_on } : {}) };
    }
  }
  throw new Error("the token does not verify (neither as an account token for this account nor as a user token)");
}

/**
 * Is a Worker present for this token? 404/10007 = absent; 403 = this (valid) token may not see it.
 * 401 or anything else = error, never "absent" nor "forbidden" (a broken token proves nothing).
 */
export async function workerAccess(cf: CloudflareClient, accountId: string, name: string): Promise<WorkerAccess> {
  const { status, body } = await cf.request("GET", `/accounts/${accountId}/workers/scripts/${name}/settings`);
  if (body?.success) return "present";
  if (cfNotFound(status, body)) return "absent";
  if (status === 403) return "forbidden";
  throw new Error(`cannot read Worker ${name}: HTTP ${status} ${cfErrors(body)}`);
}

// --- state store probe --------------------------------------------------------------------------

export interface StoreProbe {
  version: number | undefined;
  authorized: boolean;
}

/** The store's API version, and whether this bearer token is the store's own (else 401). */
export async function probeStateStore(url: string, token: string, f: Fetch = fetch): Promise<StoreProbe> {
  const headers = { authorization: `Bearer ${token}`, "user-agent": "monorepo-delivery-kit" };
  try {
    const v = await f(`${url}/version`, { headers });
    const version = v.ok ? ((await v.json()) as { version?: number }).version : (await v.arrayBuffer(), undefined);
    const s = await f(`${url}/state/stacks`, { headers });
    await s.arrayBuffer();
    return { version, authorized: s.status === 200 };
  } catch (error) {
    throw new Error(redact(`state store ${url} unreachable: ${String(error)}`, [token]));
  }
}

export function storeDecision(probe: StoreProbe, expectedVersion: number, store: string): IsolationResult {
  if (!probe.authorized) return { ok: false, reason: `the state token is not the token of ${store} (or the store is missing): wrong secret for this environment, or run the bootstrap` };
  if (probe.version !== expectedVersion) {
    return { ok: false, reason: `${store} serves state API v${probe.version ?? "unknown"}, this Alchemy expects v${expectedVersion}: re-run the bootstrap to upgrade the store (CI never creates or upgrades it)` };
  }
  return { ok: true, notes: [] };
}
