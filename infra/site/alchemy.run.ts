// Site infrastructure (Alchemy v2, Effect/TypeScript): one Cloudflare Worker per stage, one
// Cloudflare account. Values come from delivery.config.json; nothing here is project-specific.
//
//   production -> Worker <worker>            state store <worker>-state          (CI, default branch)
//   pr-<n>     -> Worker <worker>-pr-<n>     state store <worker>-preview-state  (CI, PR previews)
//   staging    -> Worker <worker>-staging    state store <worker>-preview-state  (previews.mode=staging)
//   anything else (your own name)            local state in .alchemy/, never remote
//
// The Worker serves a PREBUILT artifact (SITE_ARTIFACT_DIR): assets/ and, when site.server is true,
// server/index.js uploaded without bundling. This file never builds the site: the build ran
// earlier, unprivileged, in CI (docs/decisions.md D2).
//
// State (SITE_STATE):
//   local       default; a local deploy can never touch remote state
//   http        CI: the stage's state-store Worker over HTTPS with that store's bearer token only
//   cloudflare  bootstrap only (scripts/bootstrap.ts): Alchemy's Cloudflare.state()
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { State, localState, makeHttpStateStore } from "alchemy/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { HttpClient } from "effect/http/HttpClient";
import { join } from "node:path";
import { checkArtifact } from "./src/artifact.ts";
import { loadConfig, previewMode, repoRoot, serverEntry } from "./src/config.ts";
import { assertRevision, isRemoteStage, renderHeaders, stageKind, stateStoreFor, stateStoreUrl, stateStores, workerName } from "./src/stage.ts";

const config = loadConfig();
const base = config.site.worker;

const mode = process.env.SITE_STATE || "local";
if (mode !== "local" && mode !== "http" && mode !== "cloudflare") throw new Error(`SITE_STATE must be local, http or cloudflare, not ${JSON.stringify(mode)}`);
const remote = mode !== "local";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || undefined;

// `alchemy destroy` skips the stack program, so this guard runs at module load: a laptop cannot
// reach remote state by accident.
if (remote && !process.env.GITHUB_ACTIONS && process.env.SITE_ALLOW_LOCAL_REMOTE !== "1") {
  throw new Error(`SITE_STATE=${mode} is reserved for CI; for a deliberate local operation (bootstrap, emergency) also set SITE_ALLOW_LOCAL_REMOTE=1`);
}
const store = process.env.SITE_STATE_STORE || "";
if (remote && !Object.values<string>(stateStores(base)).includes(store)) {
  throw new Error(`SITE_STATE_STORE must be one of ${Object.values(stateStores(base)).join(", ")}`);
}

function httpState() {
  const token = process.env.SITE_STATE_TOKEN;
  const subdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  if (!token) throw new Error("SITE_STATE_TOKEN is required with SITE_STATE=http");
  if (!subdomain) throw new Error("CLOUDFLARE_WORKERS_SUBDOMAIN is required with SITE_STATE=http");
  return Layer.effect(
    State,
    Effect.gen(function* () {
      const context = yield* Effect.context<HttpClient>();
      const make = makeHttpStateStore({ url: stateStoreUrl(store, subdomain), authToken: token, id: "cloudflare-http" });
      return yield* Effect.cached(make.pipe(Effect.provideContext(context)));
    }),
  );
}

const artifactDir = process.env.SITE_ARTIFACT_DIR || join(repoRoot, config.site.artifact);

export default Alchemy.Stack(
  `${config.project}-site`,
  {
    providers: Cloudflare.providers(),
    state: mode === "http" ? httpState() : mode === "cloudflare" ? Cloudflare.state({ workerName: store, accountId }) : localState(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (isRemoteStage(stage) !== remote) {
      return yield* Effect.die(new Error(remote ? `stage ${stage} is local-only` : `stage ${stage} is deployed by CI only (remote state)`));
    }
    if (remote && stateStoreFor(base, stage) !== store) {
      return yield* Effect.die(new Error(`stage ${stage} must use state store ${stateStoreFor(base, stage)}, not ${store}`));
    }
    const kind = stageKind(stage);
    const mode = previewMode(config);
    if ((kind === "staging" && mode !== "staging") || (kind === "preview" && mode !== "dynamic")) {
      return yield* Effect.die(new Error(`stage ${stage} does not match preview mode ${mode}`));
    }

    const report = checkArtifact(artifactDir, { server: config.site.server, serverEntry: serverEntry(config) });
    const revision = process.env.SITE_REVISION ? assertRevision(process.env.SITE_REVISION) : undefined;

    const site = yield* Cloudflare.Worker("Site", {
      name: workerName(base, stage),
      ...(config.site.server ? { main: join(artifactDir, "server", serverEntry(config)), bundle: false } : {}),
      assets: {
        directory: join(artifactDir, "assets"),
        htmlHandling: config.site.htmlHandling ?? "auto-trailing-slash",
        notFoundHandling: config.site.server ? "none" : "404-page",
        headers: renderHeaders(stage, revision),
        redirects: "",
      },
      // Stable workers.dev URL only: per-version preview URLs would keep every old build public.
      workersDev: { enabled: true, previewsEnabled: false },
      observability: { enabled: config.site.server },
      logpush: false,
      // bundle: false uses the flags exactly as given: SSR bundles (node:async_hooks, node:stream)
      // need nodejs_compat, which Alchemy no longer adds by default for dates >= 2026-08-04.
      compatibility: { date: "2026-11-01", flags: config.site.server ? ["nodejs_compat"] : [] },
    });

    return { stage, worker: workerName(base, stage), url: site.url, files: report.files };
  }),
);
