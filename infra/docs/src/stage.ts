// Stage model for the docs site. Pure functions only: imported by alchemy.run.ts, the smoke test
// and the unit tests, so that the deployed names and URLs can be checked without credentials.

/** Remote stages: the only ones that may use the shared Cloudflare state store. */
export type RemoteStage = "production" | `pr-${number}`;

export const PRODUCTION = "production";
export const WORKER_BASE_NAME = "webmcp-sdk-docs";
/** Dedicated Alchemy state-store Worker, so this project never shares a store with other stacks. */
export const STATE_STORE_WORKER = "webmcp-sdk-docs-state";

const PR_STAGE = /^pr-([1-9][0-9]{0,6})$/;
// Alchemy stage syntax ([a-z0-9][-_a-z0-9]*), kept short so derived Worker names stay < 63 chars.
const ANY_STAGE = /^[a-z0-9][-_a-z0-9]{0,39}$/;

export type StageKind = "production" | "preview" | "local";

export function stageKind(stage: string): StageKind {
  if (!ANY_STAGE.test(stage)) {
    throw new Error(`invalid stage name ${JSON.stringify(stage)}`);
  }
  if (stage === PRODUCTION) return "production";
  if (PR_STAGE.test(stage)) return "preview";
  // "pr-" stages that are not exactly pr-<n> are refused: they would look like previews to a human.
  if (stage.startsWith("pr-") || stage === "prod") {
    throw new Error(`stage ${JSON.stringify(stage)} is reserved; use "production" or "pr-<number>"`);
  }
  return "local";
}

export function isRemoteStage(stage: string): stage is RemoteStage {
  return stageKind(stage) !== "local";
}

/** Stage for a pull request number, validated (the number comes from the event payload). */
export function previewStage(prNumber: string | number): RemoteStage {
  const stage = `pr-${String(prNumber)}`;
  if (!PR_STAGE.test(stage)) throw new Error(`invalid pull request number ${JSON.stringify(prNumber)}`);
  return stage as RemoteStage;
}

/**
 * Cloudflare Worker script name. Explicit (not Alchemy's derived physical name) so the
 * workers.dev URL is known before the deploy and can be baked into the static build (SITE_URL).
 * Worker names allow lowercase letters, digits and dashes only.
 */
export function workerName(stage: string): string {
  const kind = stageKind(stage);
  if (kind === "production") return WORKER_BASE_NAME;
  return `${WORKER_BASE_NAME}-${stage.replaceAll("_", "-")}`;
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** https://<worker>.<account-subdomain>.workers.dev/ — the URL Cloudflare serves the Worker at. */
export function workersDevUrl(stage: string, accountSubdomain: string): string {
  if (!SUBDOMAIN.test(accountSubdomain)) {
    throw new Error(`invalid workers.dev account subdomain ${JSON.stringify(accountSubdomain)}`);
  }
  return `https://${workerName(stage)}.${accountSubdomain}.workers.dev/`;
}

/** Only production may be indexed by search engines; previews and local stages are noindex. */
export function isIndexable(stage: string): boolean {
  return stageKind(stage) === "production";
}
