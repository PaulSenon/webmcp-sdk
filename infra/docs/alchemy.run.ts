// Docs site infrastructure (Alchemy v2): one assets-only Cloudflare Worker per stage, all in one
// Cloudflare account.
//
//   production -> Worker "webmcp-sdk-docs"          state store webmcp-sdk-docs-state          (CI, main)
//   staging    -> Worker "webmcp-sdk-docs-staging"  state store webmcp-sdk-docs-preview-state  (CI, PRs, mode staging)
//   pr-<n>     -> Worker "webmcp-sdk-docs-pr-<n>"   state store webmcp-sdk-docs-preview-state  (CI, PRs, mode dynamic)
//   anything else (default live_$USER / dev_$USER) -> local stages, local state in .alchemy/
//
// No Worker script is uploaded: Cloudflare's asset layer serves every request itself, so requests
// are free and unlimited and nothing executes at the edge. Runbook: docs/docs-deploy.md.
//
// State (DOCS_STATE):
//   local       (default) local files. A local deploy can never touch remote state.
//   http        CI: the stage's state-store Worker over HTTPS with its bearer token
//               (DOCS_STATE_TOKEN, one GitHub environment secret per store). No Cloudflare API
//               permission at all is needed for state, in particular no Secrets Store access.
//   cloudflare  bootstrap/admin only: Alchemy's own Cloudflare.state(), which deploys/upgrades the
//               store and reads its token through the account's Secrets Store.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { State, localState, makeHttpStateStore } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { HttpClient } from "effect/http/HttpClient";
import { fileURLToPath } from "node:url";
import { renderHeadersFile } from "./src/headers.ts";
import { checkSiteDir } from "./src/site-dir.ts";
import {
  STATE_STORES,
  assertRevision,
  isIndexable,
  isRemoteStage,
  stateStoreFor,
  stateStoreUrl,
  workerName,
  type StateStoreName,
} from "./src/stage.ts";

const mode = process.env.DOCS_STATE || "local";
if (mode !== "local" && mode !== "http" && mode !== "cloudflare") {
  throw new Error(`DOCS_STATE must be local, http or cloudflare, not ${JSON.stringify(mode)}`);
}
const remote = mode !== "local";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || undefined;

// Remote state outside GitHub Actions is for the one-time bootstrap (scripts/bootstrap.ts) and
// inspection. `destroy` skips the stack program below, so its stage checks do not run: without
// this guard, `alchemy destroy --stage production` from a laptop would go through.
if (remote && !process.env.GITHUB_ACTIONS && process.env.DOCS_ALLOW_LOCAL_REMOTE !== "1") {
  throw new Error(
    `DOCS_STATE=${mode} is reserved for CI. For a deliberate local operation on remote state ` +
      "(bootstrap, state list, emergency), also set DOCS_ALLOW_LOCAL_REMOTE=1.",
  );
}

// Which store: named explicitly, and checked against the stage in the program below.
const store = (process.env.DOCS_STATE_STORE || undefined) as StateStoreName | undefined;
if (remote && !Object.values<string>(STATE_STORES).includes(store ?? "")) {
  throw new Error(`DOCS_STATE_STORE must be one of ${Object.values(STATE_STORES).join(", ")}`);
}

function httpState(name: StateStoreName) {
  const token = process.env.DOCS_STATE_TOKEN;
  const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  if (!token) throw new Error("DOCS_STATE_TOKEN is required with DOCS_STATE=http");
  if (!subdomain) throw new Error("CLOUDFLARE_WORKERS_SUBDOMAIN is required with DOCS_STATE=http");
  // Same shape as Alchemy's own localState(): capture the HttpClient from the stack's services.
  return Layer.effect(
    State,
    Effect.gen(function* () {
      const context = yield* Effect.context<HttpClient>();
      const make = makeHttpStateStore({ url: stateStoreUrl(name, subdomain), authToken: token, id: "cloudflare-http" });
      return yield* Effect.cached(make.pipe(Effect.provideContext(context)));
    }),
  );
}

// The static site to serve: `pnpm docs:build` output by default; CI passes the downloaded artifact.
const siteDir =
  process.env.DOCS_SITE_DIR || fileURLToPath(new URL("../../apps/docs/out", import.meta.url));

export default Alchemy.Stack(
  "webmcp-sdk-docs",
  {
    providers: Cloudflare.providers(),
    state:
      mode === "http"
        ? httpState(store!)
        : mode === "cloudflare"
          ? // accountId pins the store: credentials for another account fail instead of using it.
            Cloudflare.state({ workerName: store!, accountId })
          : localState(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (isRemoteStage(stage) !== remote) {
      return yield* Effect.die(
        new Error(
          remote
            ? `stage ${stage} is local-only; remote state is for "production", "staging" and "pr-<n>"`
            : `stage ${stage} must be deployed by CI (remote state); use a personal stage locally`,
        ),
      );
    }
    if (remote && stateStoreFor(stage) !== store) {
      return yield* Effect.die(
        new Error(`stage ${stage} must use state store ${stateStoreFor(stage)}, not ${store}`),
      );
    }
    if (remote && !accountId) {
      return yield* Effect.die(new Error("CLOUDFLARE_ACCOUNT_ID is required with remote state"));
    }

    const report = checkSiteDir(siteDir);
    for (const warning of report.warnings) yield* Effect.logWarning(warning);

    const indexable = isIndexable(stage);
    const revision = !indexable && process.env.DOCS_REVISION ? assertRevision(process.env.DOCS_REVISION) : undefined;

    const site = yield* Cloudflare.Worker("Site", {
      name: workerName(stage),
      assets: {
        directory: siteDir,
        // /guide serves guide.html or guide/index.html, and /guide/ redirects to /guide: the site's
        // links, canonical URLs and sitemap never end with a slash (apps/docs/README.md).
        htmlHandling: "drop-trailing-slash",
        // Unmatched paths get the site's 404.html with status 404.
        notFoundHandling: "404-page",
        // Owned here; overrides any _headers / _redirects in the build output.
        headers: renderHeadersFile({ indexable, ...(revision ? { revision } : {}) }),
        redirects: "",
      },
      // Stable workers.dev URL only: per-version preview URLs would keep every old build public.
      workersDev: { enabled: true, previewsEnabled: false },
      // Assets-only: no invocations to log or trace.
      observability: { enabled: false },
      logpush: false,
      compatibility: { date: "2026-11-01" },
    });

    return { stage, worker: workerName(stage), url: site.url, files: report.files };
  }),
);
