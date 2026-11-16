// Stage model. Pure functions: names, URLs, state stores and headers are checkable without
// credentials. Adapted from webmcp-sdk infra/docs/src/stage.ts.
//
// One Cloudflare account holds every stage. Names are NOT a security boundary (a token is limited
// by its scopes, never by a name prefix); these guards stop mistakes, the tokens and the
// environments give isolation (docs/limits.md).

export type StageKind = "production" | "staging" | "preview" | "local";

export const PRODUCTION = "production";
export const STAGING = "staging";

const PR_STAGE = /^pr-([1-9][0-9]{0,6})$/;
const ANY_STAGE = /^[a-z0-9][-_a-z0-9]{0,39}$/;

export function stageKind(stage: string): StageKind {
  if (!ANY_STAGE.test(stage)) throw new Error(`invalid stage name ${JSON.stringify(stage)}`);
  if (stage === PRODUCTION) return "production";
  if (stage === STAGING) return "staging";
  if (PR_STAGE.test(stage)) return "preview";
  // Look-alikes would read as a CI stage to a human: refused.
  if (stage.startsWith("pr-") || stage === "prod" || stage === "stage" || stage.includes("state")) {
    throw new Error(`stage ${JSON.stringify(stage)} is reserved; use "production", "staging" or "pr-<number>"`);
  }
  return "local";
}

export const isRemoteStage = (stage: string) => stageKind(stage) !== "local";

export function previewStage(prNumber: string | number): `pr-${number}` {
  const stage = `pr-${String(prNumber)}`;
  if (!PR_STAGE.test(stage)) throw new Error(`invalid pull request number ${JSON.stringify(prNumber)}`);
  return stage as `pr-${number}`;
}

export function prNumberOf(stage: string): number | undefined {
  const m = PR_STAGE.exec(stage);
  return m ? Number(m[1]) : undefined;
}

/** Explicit Worker name, so the URL is known before deploying and token scopes can name it. */
export function workerName(base: string, stage: string): string {
  return stageKind(stage) === "production" ? base : `${base}-${stage.replaceAll("_", "-")}`;
}

/** Worker names of previews, for the orphan sweep. */
export function previewNumberFromWorker(base: string, name: string): number | undefined {
  if (!name.startsWith(`${base}-`)) return undefined;
  return prNumberOf(name.slice(base.length + 1));
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function assertSubdomain(subdomain: string): string {
  if (!SUBDOMAIN.test(subdomain)) throw new Error(`invalid workers.dev subdomain ${JSON.stringify(subdomain)}`);
  return subdomain;
}

export const workersDevUrl = (base: string, stage: string, subdomain: string) =>
  `https://${workerName(base, stage)}.${assertSubdomain(subdomain)}.workers.dev/`;

/** Two Alchemy state stores, one per trust level: preview credentials never hold production state. */
export function stateStores(base: string) {
  return { production: `${base}-state`, preview: `${base}-preview-state` } as const;
}

export function stateStoreFor(base: string, stage: string): string {
  const kind = stageKind(stage);
  if (kind === "local") throw new Error(`local stage ${stage} has no remote state store`);
  return kind === "production" ? stateStores(base).production : stateStores(base).preview;
}

export const stateStoreUrl = (store: string, subdomain: string) => `https://${store}.${assertSubdomain(subdomain)}.workers.dev`;

const REVISION = /^(main|pr-[1-9][0-9]{0,6})@[0-9a-f]{7}$/;

/** `pr-6@abc1234` / `main@abc1234`: served as a response header so humans and smoke tests see what is live. */
export function revisionLabel(source: { pr?: number; sha: string }): string {
  if (!/^[0-9a-f]{40}$/.test(source.sha)) throw new Error("invalid commit SHA");
  const label = `${source.pr ? previewStage(source.pr) : "main"}@${source.sha.slice(0, 7)}`;
  if (!REVISION.test(label)) throw new Error(`invalid revision ${label}`);
  return label;
}

export function assertRevision(label: string): string {
  if (!REVISION.test(label)) throw new Error(`invalid revision label ${JSON.stringify(label)}`);
  return label;
}

/**
 * `_headers` for static assets: only production is indexable; every stage says which commit it
 * serves. Owned by the infra (overrides any `_headers` in the build output).
 */
export function renderHeaders(stage: string, revision?: string): string {
  const lines = ["/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin"];
  if (stageKind(stage) !== "production") lines.push("  X-Robots-Tag: noindex, nofollow");
  if (revision) lines.push(`  X-Delivery-Revision: ${assertRevision(revision)}`);
  // shadcn registry: fetched cross-origin by the shadcn CLI and by browsers.
  // Previews change on every push: never cached. Production: 5 minutes.
  lines.push("/r/*", "  Access-Control-Allow-Origin: *", stageKind(stage) === "production" ? "  Cache-Control: public, max-age=300" : "  Cache-Control: no-cache");
  return `${lines.join("\n")}\n`;
}

/** The stage a PR deploys to. */
export function prStage(mode: "dynamic" | "staging", prNumber: number | string): string {
  const stage = previewStage(prNumber); // validates the number in both modes
  return mode === "dynamic" ? stage : STAGING;
}
