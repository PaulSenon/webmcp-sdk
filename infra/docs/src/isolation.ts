// Single-account isolation rules, checked by `cli.ts preflight` before any alchemy call with a
// deploy token. Pure decision logic; the probes (Cloudflare, GitHub, state store) are in cli.ts.
//
// One Cloudflare account holds production, staging and previews. Worker names are not a security
// boundary: what a token can touch is decided by its scopes. So the workflow does not trust the
// names alone, it probes what the token can actually see and refuses unsafe combinations.

import { redact, type Fetch } from "./api.ts";
import { stageKind, type PreviewMode } from "./stage.ts";

export type WorkerAccess = "present" | "absent" | "forbidden";

export interface IsolationInput {
  stage: string;
  mode: PreviewMode;
  /** What this token sees of the stage's own Worker. */
  target: WorkerAccess;
  /** What this token sees of the production Worker (only probed for non-production stages). */
  production: WorkerAccess | undefined;
  /** The job's GitHub environment protection (read from the API). */
  protection: EnvironmentProtection;
}

export interface EnvironmentProtection {
  /** Number of required reviewers. */
  reviewers: number;
  /** Deployment branch policy allows `main` and nothing else (no refs/pull/*, no other branch, no tags). */
  mainOnly: boolean;
}

/**
 * Is a preview-side token that can reach production acceptable? Only if its environment cannot be
 * used by code that did not land on main: either a human approves each run (required reviewer),
 * or the environment only releases secrets to runs on `main` (the deploy workflow is
 * `workflow_run`/schedule/dispatch on main; a PR that adds or edits a workflow runs on
 * refs/pull/<n>/merge and is refused by the environment).
 */
export function environmentGuards(p: EnvironmentProtection): boolean {
  return p.reviewers > 0 || p.mainOnly;
}

/** Branch policy is exactly one custom branch policy named `main` (pure, from the API responses). */
export function isMainOnly(policy: { protected_branches?: boolean; custom_branch_policies?: boolean } | null | undefined, rules: readonly { name: string; type?: string }[]): boolean {
  if (!policy || policy.protected_branches || !policy.custom_branch_policies) return false;
  return rules.length === 1 && rules[0]?.name === "main" && (rules[0].type ?? "branch") === "branch";
}

export type IsolationResult = { ok: true; notes: string[] } | { ok: false; reason: string };

export function isolationDecision(input: IsolationInput): IsolationResult {
  const kind = stageKind(input.stage);
  const notes: string[] = [];
  if (kind === "local") return { ok: false, reason: `local stage ${input.stage} cannot deploy from CI` };

  if (kind === "production") {
    // The production token is Editor on webmcp-sdk-docs: it can update it, never create it.
    if (input.target !== "present") {
      return { ok: false, reason: `the production Worker is ${input.target} for this token: run the bootstrap (creates it) and scope the token to it` };
    }
    return { ok: true, notes };
  }

  if (kind === "staging" && input.mode !== "staging") return { ok: false, reason: "stage staging is only used in DOCS_PREVIEW_MODE=staging" };
  if (kind === "preview" && input.mode !== "dynamic") return { ok: false, reason: "per-PR stages are only used in DOCS_PREVIEW_MODE=dynamic" };

  if (kind === "staging" && input.target !== "present") {
    return { ok: false, reason: `the staging Worker is ${input.target} for this token: run the bootstrap (creates it) and scope the token to it` };
  }

  // Can this preview-side token reach production? Then a human must approve every run.
  const reachesProduction = input.mode === "dynamic" || input.production === "present";
  if (reachesProduction) {
    if (!environmentGuards(input.protection)) {
      return {
        ok: false,
        reason:
          input.mode === "dynamic"
            ? "DOCS_PREVIEW_MODE=dynamic needs an account-wide Workers token, which can also modify or delete production: restrict the docs-preview environment to branch main only, or add a required reviewer"
            : "the staging token can see the production Worker (it is broader than Editor on webmcp-sdk-docs-staging): narrow it, or restrict docs-preview to main only / add a required reviewer",
      };
    }
    const why = [input.protection.mainOnly ? "only releases secrets to main" : "", input.protection.reviewers > 0 ? "requires a reviewer" : ""].filter(Boolean).join(" and ");
    notes.push(`this token can reach the production Worker; accepted because the environment ${why}`);
  }
  return { ok: true, notes };
}

// --- state store probe --------------------------------------------------------------------------

export interface StoreProbe {
  version: number | undefined;
  authorized: boolean;
}

/**
 * Probe a state-store Worker over HTTP with its bearer token: the version it serves, and whether
 * the token is the one of this store (a production token in the preview environment, or the
 * reverse, gets 401).
 */
export async function probeStateStore(url: string, token: string, f: Fetch = fetch): Promise<StoreProbe> {
  const headers = { authorization: `Bearer ${token}`, "user-agent": "webmcp-sdk-docs-infra" };
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
  if (!probe.authorized) {
    return { ok: false, reason: `DOCS_STATE_TOKEN is not the token of ${store} (or the store is missing): wrong secret for this environment, or run the bootstrap` };
  }
  if (probe.version !== expectedVersion) {
    return {
      ok: false,
      reason: `${store} serves state API v${probe.version ?? "unknown"}, this Alchemy expects v${expectedVersion}: re-run the bootstrap to upgrade the store (CI never creates or upgrades it)`,
    };
  }
  return { ok: true, notes: [] };
}
