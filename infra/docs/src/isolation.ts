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
  /** Required reviewers configured on the job's GitHub environment. */
  reviewers: number;
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
    if (input.reviewers < 1) {
      return {
        ok: false,
        reason:
          input.mode === "dynamic"
            ? "DOCS_PREVIEW_MODE=dynamic needs an account-wide Workers token, which can also modify or delete production: add a required reviewer to the docs-preview environment"
            : "the staging token can see the production Worker (it is broader than Editor on webmcp-sdk-docs-staging): narrow it, or add a required reviewer to the docs-preview environment",
      };
    }
    notes.push("this token can reach the production Worker; the run was approved by a required reviewer");
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
