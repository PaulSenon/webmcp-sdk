// Stage model for the docs site. Pure functions only: imported by alchemy.run.ts, the CI helpers
// and the unit tests, so that the deployed names, URLs and state stores can be checked without
// credentials.
//
// One Cloudflare account holds everything. Names are NOT a security boundary: a Cloudflare token
// is limited by the Workers it is scoped to (per-Worker roles), never by a name prefix. The guards
// here only stop mistakes (wrong stage, wrong store); isolation comes from the tokens.

export type RemoteStage = "production" | "staging" | `pr-${number}`;

export const PRODUCTION = "production";
export const STAGING = "staging";
export const WORKER_BASE_NAME = "webmcp-sdk-docs";

/**
 * Alchemy state-store Workers, one per trust level, so the staging/preview credentials can never
 * read or write production state: each store has its own bearer token.
 */
export const STATE_STORES = {
  production: "webmcp-sdk-docs-state",
  preview: "webmcp-sdk-docs-preview-state",
} as const;
export type StateStoreName = (typeof STATE_STORES)[keyof typeof STATE_STORES];

const PR_STAGE = /^pr-([1-9][0-9]{0,6})$/;
// Alchemy stage syntax ([a-z0-9][-_a-z0-9]*), kept short so derived Worker names stay < 63 chars.
const ANY_STAGE = /^[a-z0-9][-_a-z0-9]{0,39}$/;

export type StageKind = "production" | "staging" | "preview" | "local";

export function stageKind(stage: string): StageKind {
  if (!ANY_STAGE.test(stage)) {
    throw new Error(`invalid stage name ${JSON.stringify(stage)}`);
  }
  if (stage === PRODUCTION) return "production";
  if (stage === STAGING) return "staging";
  if (PR_STAGE.test(stage)) return "preview";
  // Look-alikes are refused: they would read as production/staging/previews to a human.
  if (stage.startsWith("pr-") || stage === "prod" || stage === "stage" || stage.includes("state")) {
    throw new Error(`stage ${JSON.stringify(stage)} is reserved; use "production", "staging" or "pr-<number>"`);
  }
  return "local";
}

export function isRemoteStage(stage: string): stage is RemoteStage {
  return stageKind(stage) !== "local";
}

/** Stage for a pull request number, validated (the number comes from the event payload). */
export function previewStage(prNumber: string | number): `pr-${number}` {
  const stage = `pr-${String(prNumber)}`;
  if (!PR_STAGE.test(stage)) throw new Error(`invalid pull request number ${JSON.stringify(prNumber)}`);
  return stage as `pr-${number}`;
}

/**
 * Cloudflare Worker script name. Explicit (not Alchemy's derived physical name) so the
 * workers.dev URL is known before the deploy and can be baked into the static build (SITE_URL),
 * and so per-Worker token scopes can name it. Lowercase letters, digits and dashes only.
 */
export function workerName(stage: string): string {
  const kind = stageKind(stage);
  if (kind === "production") return WORKER_BASE_NAME;
  return `${WORKER_BASE_NAME}-${stage.replaceAll("_", "-")}`;
}

/** The state store a remote stage must use. Local stages use local state. */
export function stateStoreFor(stage: string): StateStoreName {
  const kind = stageKind(stage);
  if (kind === "production") return STATE_STORES.production;
  if (kind === "staging" || kind === "preview") return STATE_STORES.preview;
  throw new Error(`local stage ${JSON.stringify(stage)} has no remote state store`);
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function assertSubdomain(accountSubdomain: string): string {
  if (!SUBDOMAIN.test(accountSubdomain)) {
    throw new Error(`invalid workers.dev account subdomain ${JSON.stringify(accountSubdomain)}`);
  }
  return accountSubdomain;
}

/** https://<worker>.<account-subdomain>.workers.dev/ — the URL Cloudflare serves the Worker at. */
export function workersDevUrl(stage: string, accountSubdomain: string): string {
  return `https://${workerName(stage)}.${assertSubdomain(accountSubdomain)}.workers.dev/`;
}

/** The state-store Worker's own workers.dev origin (no trailing slash, as Alchemy builds it). */
export function stateStoreUrl(store: StateStoreName, accountSubdomain: string): string {
  return `https://${store}.${assertSubdomain(accountSubdomain)}.workers.dev`;
}

/** Only production may be indexed by search engines; staging, previews and local stages are noindex. */
export function isIndexable(stage: string): boolean {
  return stageKind(stage) === "production";
}

// --- preview mode -------------------------------------------------------------------------------

/**
 * How PRs are previewed (repository variable DOCS_PREVIEW_MODE):
 * - `staging` (default): one fixed Worker `webmcp-sdk-docs-staging`, created once at bootstrap;
 *   its token is Editor on that Worker only, so it cannot create, delete or touch production.
 *   The last PR deployed wins.
 * - `dynamic`: one Worker per PR (`webmcp-sdk-docs-pr-<n>`), created and destroyed by CI. Needs an
 *   account-wide Workers Admin token (which can also modify or delete production), so it is only
 *   allowed when the `docs-preview` environment has a required reviewer.
 */
export type PreviewMode = "staging" | "dynamic";

export function parsePreviewMode(value: string | undefined): PreviewMode {
  if (value === undefined || value === "" || value === "staging") return "staging";
  if (value === "dynamic") return "dynamic";
  throw new Error(`DOCS_PREVIEW_MODE must be "staging" or "dynamic", not ${JSON.stringify(value)}`);
}

/** The stage a PR deploys to in a mode. */
export function prStage(mode: PreviewMode, prNumber: string | number): RemoteStage {
  const pr = previewStage(prNumber); // validates the number in both modes
  return mode === "dynamic" ? pr : STAGING;
}

// --- revision label -----------------------------------------------------------------------------

const REVISION = /^(main|pr-[1-9][0-9]{0,6})@[0-9a-f]{7}$/;

/** `pr-6@abc1234` or `main@abc1234`: what a non-production stage currently serves (response header). */
export function revisionLabel(source: { pr?: string | number; sha: string }): string {
  const label = `${source.pr ? previewStage(source.pr) : "main"}@${source.sha.slice(0, 7)}`;
  if (!REVISION.test(label)) throw new Error(`invalid revision ${JSON.stringify(label)}`);
  return label;
}

export function assertRevision(label: string): string {
  if (!REVISION.test(label)) throw new Error(`invalid revision label ${JSON.stringify(label)}`);
  return label;
}
