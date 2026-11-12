// Docs site infrastructure (Alchemy v2): one assets-only Cloudflare Worker per stage.
//
//   production  -> Worker "webmcp-sdk-docs"        (CI, from main, environment docs-production)
//   pr-<n>      -> Worker "webmcp-sdk-docs-pr-<n>" (CI, same-repo PRs, environment docs-preview)
//   anything else (default live_$USER / dev_$USER) -> local stages, local state in .alchemy/
//
// No Worker script is uploaded: Cloudflare's asset layer serves every request itself, so requests
// are free and unlimited and nothing executes at the edge. Runbook: docs/docs-deploy.md.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { localState } from "alchemy/State";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { renderHeadersFile } from "./src/headers.ts";
import { checkSiteDir } from "./src/site-dir.ts";
import { STATE_STORE_WORKER, isIndexable, isRemoteStage, workerName } from "./src/stage.ts";

// DOCS_STATE=cloudflare is set by the deploy workflow only. Everything else uses local state, so a
// local `alchemy deploy` or `alchemy dev` can never read or write production state by accident.
const remoteState = process.env.DOCS_STATE === "cloudflare";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || undefined;

// Remote state outside GitHub Actions is for the one-time bootstrap and inspection
// (docs/docs-deploy.md §4.2). `destroy` skips the stack program below, so its stage checks do not
// run: without this guard, `alchemy destroy --stage production` from a laptop would go through.
if (remoteState && !process.env.GITHUB_ACTIONS && process.env.DOCS_ALLOW_LOCAL_REMOTE !== "1") {
  throw new Error(
    "DOCS_STATE=cloudflare is reserved for CI. For a deliberate local operation on remote state " +
      "(state bootstrap, state list, emergency), also set DOCS_ALLOW_LOCAL_REMOTE=1.",
  );
}

// The static site to serve: `pnpm docs:build` output by default; CI passes the downloaded artifact.
const siteDir =
  process.env.DOCS_SITE_DIR || fileURLToPath(new URL("../../apps/docs/out", import.meta.url));

export default Alchemy.Stack(
  "webmcp-sdk-docs",
  {
    providers: Cloudflare.providers(),
    state: remoteState
      ? // accountId pins the store: credentials for another account fail instead of using it.
        Cloudflare.state({ workerName: STATE_STORE_WORKER, accountId })
      : localState(),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (isRemoteStage(stage) !== remoteState) {
      return yield* Effect.die(
        new Error(
          remoteState
            ? `stage ${stage} is local-only; remote state is for "production" and "pr-<n>"`
            : `stage ${stage} must be deployed by CI (DOCS_STATE=cloudflare); use a personal stage locally`,
        ),
      );
    }
    if (remoteState && !accountId) {
      return yield* Effect.die(new Error("CLOUDFLARE_ACCOUNT_ID is required with DOCS_STATE=cloudflare"));
    }

    const report = checkSiteDir(siteDir);
    for (const warning of report.warnings) yield* Effect.logWarning(warning);

    const site = yield* Cloudflare.Worker("Site", {
      name: workerName(stage),
      assets: {
        directory: siteDir,
        // /guide serves guide.html or guide/index.html; trailing slashes are normalized by redirect.
        htmlHandling: "auto-trailing-slash",
        // Unmatched paths get the site's 404.html with status 404.
        notFoundHandling: "404-page",
        // Owned here; overrides any _headers / _redirects in the build output.
        headers: renderHeadersFile({ indexable: isIndexable(stage) }),
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
