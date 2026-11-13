// Cloudflare account checks shared by the CI deploy jobs (`cli.ts check-store`) and the one-time
// bootstrap (`scripts/bootstrap.ts`). Never prints or returns the token.
import { ACCOUNT_ID, cfErrors, type CloudflareClient } from "./api.ts";
import { STATE_STORE_WORKER } from "./stage.ts";

export type TokenKind = "account" | "user";

/**
 * Account-owned tokens verify at /accounts/{id}/tokens/verify, user tokens at /user/tokens/verify.
 * https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/
 */
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

/** The account's name when the token may read it (needs no extra permission for Super Admin tokens). */
export async function accountName(cf: CloudflareClient, accountId: string): Promise<string | undefined> {
  const { body } = await cf.request<{ name: string }>("GET", `/accounts/${accountId}`);
  return body?.success ? body.result.name : undefined;
}

/** `<sub>` of https://<worker>.<sub>.workers.dev, or undefined when the account has none yet. */
export async function getWorkersSubdomain(cf: CloudflareClient, accountId: string): Promise<string | undefined> {
  const { status, body } = await cf.request<{ subdomain?: string }>("GET", `/accounts/${accountId}/workers/subdomain`);
  if (body?.success) return body.result?.subdomain || undefined;
  if (status === 404 || /not found|no subdomain|10007/i.test(cfErrors(body))) return undefined;
  throw new Error(`cannot read the workers.dev subdomain: HTTP ${status} ${cfErrors(body)}`);
}

/**
 * Create the account's workers.dev subdomain (PUT /accounts/{id}/workers/subdomain, permission
 * Workers Scripts Write). Only when the account has none: changing an existing one would break
 * every workers.dev URL of the account.
 * https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/
 */
export async function ensureWorkersSubdomain(cf: CloudflareClient, accountId: string, wanted: string | undefined) {
  const existing = await getWorkersSubdomain(cf, accountId);
  if (existing) {
    if (wanted && wanted !== existing) {
      throw new Error(`the account already uses the workers.dev subdomain "${existing}"; not changing it to "${wanted}"`);
    }
    return { subdomain: existing, created: false };
  }
  if (!wanted) throw new Error("the account has no workers.dev subdomain yet: pass --subdomain <name> to create it");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(wanted)) throw new Error("invalid subdomain name");
  const { status, body } = await cf.request<{ subdomain: string }>("PUT", `/accounts/${accountId}/workers/subdomain`, { subdomain: wanted });
  if (!body?.success) throw new Error(`cannot create the workers.dev subdomain: HTTP ${status} ${cfErrors(body)}`);
  return { subdomain: body.result.subdomain, created: true };
}

/** Is the bootstrapped Alchemy state-store Worker present in this account? */
export async function stateStorePresent(cf: CloudflareClient, accountId: string): Promise<boolean> {
  const { status, body } = await cf.request("GET", `/accounts/${accountId}/workers/scripts/${STATE_STORE_WORKER}/settings`);
  if (body?.success) return true;
  if (status === 404) return false;
  throw new Error(`cannot read the state store ${STATE_STORE_WORKER}: HTTP ${status} ${cfErrors(body)} (token permissions?)`);
}
