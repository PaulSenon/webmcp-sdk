// delivery.config.json: the only project-specific values of the delivery kit. Read by the site
// infrastructure (alchemy.run.ts, scripts/cli.ts) and the release tooling. In privileged jobs it is
// always read from the checkout of the default branch, never from a pull request.
import { readFileSync } from "node:fs";
import { validateHeaderRules } from "./stage.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface DeliveryConfig {
  project: string;
  site: {
    /**
     * Site name: workflow `<name>` / `<name>-deploy`, job `<name>-build`, environments
     * `<name>-preview` / `<name>-production`, variables `<NAME>_*`, secret `<NAME>_STATE_TOKEN`,
     * artifact `<name>`, commit status `<name>-preview` (tooling/rename-site.mjs applies it).
     */
    name: string;
    /** Production Worker name (convention `<project>-<name>`); previews are `<worker>-pr-<n>`, staging `<worker>-staging`. */
    worker: string;
    /** Build output, relative to the repository root: `assets/` and, if `server`, `server/index.js`. */
    artifact: string;
    /** true: `server/` holds a prebuilt ESM Worker (SSR, API routes), uploaded byte-for-byte. */
    server: boolean;
    /** Entry module inside `server/` (default "index.js"; TanStack Start emits "server.js"). */
    serverEntry?: string;
    /** Project response headers for static assets, merged into the kit's (e.g. a CSP): pattern -> name -> value. */
    headers?: Record<string, Record<string, string>>;
    /** Cloudflare asset trailing-slash policy (default "auto-trailing-slash"; WebMCP: "drop-trailing-slash"). */
    htmlHandling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
    /** Paths the smoke test fetches after each deploy (expects 2xx). */
    smokePaths: string[];
  };
  previews: {
    enabled: boolean;
    /**
     * "dynamic" (default, Vercel-like): one Worker per PR, created and destroyed by CI; needs an
     * account-wide Workers Admin token (docs/limits.md L1). "staging": every PR deploys to the one fixed
     * `<worker>-staging` Worker (last deploy wins) with a token scoped to that Worker only.
     */
    mode: "dynamic" | "staging";
    /**
     * Every check that must be green on the exact commit before ANY deploy (preview and
     * production): check-run names (GitHub Actions jobs) or commit-status contexts written by
     * github-actions[bot]. Only checks that run on BOTH pull_request and push (no PR-only check).
     */
    requiredChecks: string[];
    gateTimeoutMinutes: number;
  };
  release: {
    /** Public package directories, relative to the repository root. */
    packages: string[];
    /** Release branch -> the only npm dist-tag it may publish. */
    branches: Record<string, string>;
    /** "stage" (default): npm stage publish via OIDC, then the owner approves on npmjs.com with 2FA.
     *  "direct": npm publish via OIDC, no npm-side approval (the npm-release environment reviewer remains). */
    mode: "direct" | "stage";
  };
}

const NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const REL_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

export function validateConfig(raw: unknown): DeliveryConfig {
  const fail = (msg: string): never => {
    throw new Error(`delivery.config.json: ${msg}`);
  };
  const c = raw as DeliveryConfig;
  if (!c || typeof c !== "object") fail("not an object");
  if (!NAME.test(c.project ?? "")) fail("project must be a short lowercase name");
  const s = c.site ?? fail("site is required");
  if (!/^[a-z][a-z0-9]{1,15}$/.test(s.name ?? "")) fail("site.name must be lowercase letters/digits (it becomes <NAME>_* variables)");
  // Worker names: <= 63 chars once "-pr-9999999" or "-staging" is appended.
  if (!NAME.test(s.worker ?? "") || s.worker.length > 40) fail("site.worker must be lowercase letters, digits, dashes, <= 40 chars");
  if (s.worker.includes("-pr-") || s.worker.endsWith("-staging") || s.worker.endsWith("-state")) fail("site.worker uses a reserved suffix");
  if (!REL_PATH.test(s.artifact ?? "")) fail("site.artifact must be a relative path without ..");
  if (typeof s.server !== "boolean") fail("site.server must be a boolean");
  try {
    validateHeaderRules(s.headers);
  } catch (e) {
    fail((e as Error).message);
  }
  if (s.htmlHandling !== undefined && !["auto-trailing-slash", "force-trailing-slash", "drop-trailing-slash", "none"].includes(s.htmlHandling)) fail("site.htmlHandling must be a Cloudflare htmlHandling value");
  if (s.serverEntry !== undefined && !/^[A-Za-z0-9_-]+\.m?js$/.test(s.serverEntry)) fail("site.serverEntry must be a .js/.mjs file name inside server/");
  if (!Array.isArray(s.smokePaths) || !s.smokePaths.every((p) => /^\/[A-Za-z0-9._/-]*$/.test(p))) fail("site.smokePaths must be absolute URL paths");
  const p = c.previews ?? fail("previews is required");
  if (typeof p.enabled !== "boolean") fail("previews.enabled must be a boolean");
  if (p.mode !== "dynamic" && p.mode !== "staging") fail('previews.mode must be "dynamic" or "staging"');
  if (!Array.isArray(p.requiredChecks) || !p.requiredChecks.length || !p.requiredChecks.every((n) => typeof n === "string" && n.length > 0)) fail("previews.requiredChecks must list check names");
  if (!p.requiredChecks.includes(`${s.name}-build`)) fail(`previews.requiredChecks must include ${s.name}-build`);
  // The deploy writes the <name>-preview status itself: requiring it would let a deploy satisfy its own gate.
  if (p.requiredChecks.includes(`${s.name}-preview`)) fail(`previews.requiredChecks must not include ${s.name}-preview`);
  if (!Number.isInteger(p.gateTimeoutMinutes) || p.gateTimeoutMinutes < 1 || p.gateTimeoutMinutes > 120) fail("previews.gateTimeoutMinutes must be 1..120");
  const r = c.release ?? fail("release is required");
  if (!Array.isArray(r.packages) || !r.packages.length || !r.packages.every((d) => REL_PATH.test(d))) fail("release.packages must list package directories");
  if (!r.branches || !Object.entries(r.branches).every(([b, t]) => /^[a-z0-9._/-]+$/.test(b) && /^[a-z][a-z0-9-]*$/.test(t))) fail("release.branches must map branch -> dist-tag");
  if (r.mode !== "direct" && r.mode !== "stage") fail('release.mode must be "direct" or "stage"');
  return c;
}

/** Repository root: infra/site/src -> ../../.. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** previews.mode, overridable by the repository variable <NAME>_PREVIEW_MODE (passed as PREVIEW_MODE). */
export function previewMode(c: DeliveryConfig, override = process.env.PREVIEW_MODE): "dynamic" | "staging" {
  const v = override || c.previews.mode;
  if (v !== "dynamic" && v !== "staging") throw new Error(`preview mode must be "dynamic" or "staging", not ${JSON.stringify(v)}`);
  return v;
}

export const serverEntry = (c: DeliveryConfig) => c.site.serverEntry ?? "index.js";

export function loadConfig(path = process.env.DELIVERY_CONFIG || join(repoRoot, "delivery.config.json")): DeliveryConfig {
  return validateConfig(JSON.parse(readFileSync(path, "utf8")));
}
