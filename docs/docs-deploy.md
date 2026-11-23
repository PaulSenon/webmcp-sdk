# Docs site deployment

Maintainer runbook for the documentation site (`apps/docs`) on Cloudflare, in **one Cloudflare account** (Isaac's existing one, shared with Better Upload). The pipeline is **vendored from the Monorepo Delivery Kit** ([`.delivery-kit-version`](../.delivery-kit-version): `v0.1.5`); this file covers what is specific to WebMCP: verified Cloudflare facts, tokens, residual risks, setup and operations. The generic contract (workflows, artifact layout, stages, PR feedback) is the kit's `docs/contract.md`.

- Site build (unprivileged): [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) (kit `site.yml`, rendered for `docs`), jobs `lifecycle` and `docs-build`.
- Deploys (privileged, main-defined): [`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml) (kit `site-deploy.yml`), jobs `deploy-plan`, `deploy-preview`, `deploy-teardown`, `deploy-comment`, `deploy-production`, `deploy-sweep`.
- Infrastructure as code: [`infra/site`](../infra/site) (kit, Alchemy v2, private package `@senon/webmcp-sdk-docs-infra`). Project configuration: [`delivery.config.json`](../delivery.config.json) (including `site.headers`), [`tooling/docs-site-build.mjs`](../tooling/docs-site-build.mjs).
- **Deploys are off** until the repository variable `DOCS_DEPLOY_ENABLED` is `true` (§6). Until then only `docs` runs, without credentials.
- **Preview mode:** `DOCS_PREVIEW_MODE=dynamic` (Isaac, 2026-11-14): one Worker per PR. `staging` remains available (§4).
- The npm release (`release.yml`, `tooling/release/`, [`releasing.md`](releasing.md)) is **not** vendored from the kit (§2.2).

## 1. Verified facts (2026-11-14)

Legend: ✅ documented by Cloudflare or read in the Alchemy source; ❓ not verifiable without a live deploy, with the fallback.

**Pricing.** Creating a Cloudflare account is free, and an additional account starts on the Free plan ([create account](https://developers.cloudflare.com/fundamentals/account/create-account/)). Workers Paid is a subscription **per account**: "a minimum charge of $5 USD per month for an account" ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), updated 2026-11-13). Requests to static assets are free and unlimited on every plan. This design uses Isaac's existing account and creates no account and no subscription. ✅

**Workers roles and scopes** ([Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/), [changelog 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/), [Durable Objects](https://developers.cloudflare.com/workers/authorization/durable-objects/)) ✅

| Role | What it can do | Create a Worker? | Delete? |
| - | - | - | - |
| Metadata Read-Only | metadata, settings, metrics, logs, traces | no | no |
| Content Read-Only | + script source | no | no |
| **Editor** | read, update, **deploy**, rename existing Workers: script content, settings, schedules, versions, deployments, observability | **no** | **no** |
| Admin | everything, incl. create and delete at product scope; per-Worker Admin applies only to the selected Worker (so it can delete that one) | product scope only | yes |

- Scopes are **Workers product** (every current *and future* Worker of the account) or **Individual Workers** (an explicit list). "You cannot grant per-Worker access to a Worker that does not exist yet. Creating new Workers requires product-level Admin access."
- There is **no name-prefix or pattern scope**. **Worker and stage names (`webmcp-sdk-docs-*`, `pr-<n>`, `staging`) are not an IAM boundary**: they prevent mistakes, never an attack. Isolation comes only from per-Worker token scopes.
- Durable Objects (used by the Alchemy state store) have no roles of their own: access follows the Worker that implements them.

**Endpoints used by an assets-only deploy, with the permissions the API reference accepts** ([Workers API](https://developers.cloudflare.com/api/resources/workers/)):

| Call (Alchemy) | Endpoint | Accepted permissions | Per-Worker Editor? |
| - | - | - | - |
| upload/update script | `PUT /accounts/{id}/workers/scripts/{name}` | Workers Scripts Write, Workers Admin/Editor, Individual Workers Admin/Editor | ✅ |
| create deployment | `POST …/scripts/{name}/deployments` | same | ✅ |
| workers.dev on/off for the script | `POST …/scripts/{name}/subdomain` | same | ✅ |
| script settings read / edit | `GET/PATCH …/scripts/{name}/script-settings` | same (+ read roles) | ✅ |
| **assets upload session** | `POST …/scripts/{name}/assets-upload-session` | **Workers Scripts Write only** | ❓ not listed |
| delete script | `DELETE …/scripts/{name}` | Workers Scripts Write, Workers Admin, Individual Workers Admin | no (Admin) |
| account workers.dev subdomain read | `GET /accounts/{id}/workers/subdomain` | Workers Scripts Read/Write | no (product, legacy) |
| account workers.dev subdomain create | `PUT /accounts/{id}/workers/subdomain` | Workers Scripts Write | no (product, legacy) |

Minimal sets:

- **(a) deploy an existing assets-only Worker:** Workers → Individual Workers (that Worker) → **Editor**. Alchemy reads the account subdomain at the account level unless `CLOUDFLARE_WORKERS_SUBDOMAIN` is set (read in `WorkerProvider.ts`); the workflow sets it, so no account-level read is needed. ❓ The assets-upload-session endpoint lists only the legacy *Workers Scripts Write* (= Editor at product scope per Cloudflare's legacy mapping). If the first deploy fails there with a 403, the fallback is Workers → All Workers → **Editor**: still cannot create or delete, but can modify every Worker of the account (see §4).
- **(b) create and destroy a Worker:** Workers → All Workers → **Admin** (create needs product scope; destroy alone needs Admin on that Worker).
- **(c) workers.dev subdomain:** read: legacy *Workers Scripts Read* (or Write); write: legacy *Workers Scripts Write*. Isaac's account already has one (it runs Workers), so nothing needs to write it; the bootstrap takes it as `--subdomain` if it cannot read it.
- **Zones: none.** workers.dev needs no zone permission. A future custom domain adds **Zone → Workers Routes → Edit on that one zone** to the production token only (per-Worker roles do not cover custom domains yet) (§7).

**Account API tokens** ([account tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), [create token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)): owned by the account (survive a member leaving), `cfat_` prefix detectable by secret scanning, created under **Manage Account → API Tokens**. All tokens in this design are account-owned; `preflight` refuses user tokens. ✅

**Secrets Store** ([access control](https://developers.cloudflare.com/secrets-store/access-control/)) ✅: API tokens get **Account Secrets Store Read** (metadata only) or **Edit** (create, edit, delete secrets, *and* bind any secret to a resource). The permission is **account-wide**: no per-store or per-secret token scope is documented. A token with Edit and the right to deploy any Worker can therefore bind *any* secret of the account to that Worker and read its value.

**Alchemy v2 (beta.85) state, from its source** ✅

- `Cloudflare.state()` keeps state in a state-store Worker (SQLite Durable Object) whose bearer token and encryption key live in the account's Secrets Store (`AlchemyStateStoreToken_<worker>`). Every run outside its local cache reads the token by uploading an ephemeral **edge preview of the state-store Worker that binds the secret** (`readSecretViaEdge`): that needs Secrets Store **Edit** plus deploy rights on the state Worker. `--yes` also lets it create or replace the store (`updateStateStore`).
- `alchemy/State` exports `makeHttpStateStore({ url, authToken })`, the HTTP client `Cloudflare.state()` itself uses once it has the token. **This design uses it in CI**: the stack reaches the store over HTTPS with the store's bearer token passed as an environment secret (`DOCS_STATE_TOKEN`). CI therefore needs **no Secrets Store permission and no permission on the state-store Workers**, cannot create or upgrade a store, and `preflight` checks the store's API version.
- Stores are **per trust level**: `webmcp-sdk-docs-state` (production) and `webmcp-sdk-docs-preview-state` (staging and previews), each with its own bearer token. The `docs-preview` environment only holds the preview store's token, so preview credentials cannot read or write production state.
- Only the one-time bootstrap (§6) uses `Cloudflare.state()`, with a temporary token Isaac deletes afterwards.
- Alternatives considered: local state (not shared), AWS/GCP/Postgres stores (need another cloud or a database).

## 2. Architecture

```
 docs.yml  (pull_request: opened/synchronize/reopened/closed, push main) ─ UNPRIVILEGED, runs PR code, no secret
   docs-build   install ─ build-target (stage, SITE_URL) ─ pnpm site:build (Fumadocs → .artifacts/docs/assets)
                ─ write-manifest {sha, pr, stage, event, action} ─ check-artifact ─ local workerd smoke
                ─ artifact `docs`
   lifecycle    always (no-op on closed): the run completes, docs-deploy reconciles
        │ workflow_run: requested (comment "building") + completed  (docs-deploy.yml always runs main's definition)
        │ schedule: hourly reconciliation sweep, independent of any CI run
        ▼
 docs-deploy.yml ─ PRIVILEGED, main-defined; environments docs-preview / docs-production (main only)
   deploy-plan        run read back by id, PR resolved + verified from the API, plan, GATE (no secret)
   deploy-preview     PR re-checked → artifact ZIP → hardened unzip → manifest == recomputed →
                      preflight → alchemy deploy → smoke → closed/drafted meanwhile? destroy
   deploy-teardown    idempotent destroy (reopen keeps the preview)
   deploy-comment     one PR comment `<!-- delivery-kit:webmcp-sdk:preview -->` + status `docs-preview`
   deploy-production  still head of main? artifact → preflight → deploy → smoke  | rollback_run_id
   deploy-sweep       hourly / dispatch: orphan previews (Workers ∪ Alchemy state stages), retried until removed

 One Cloudflare account (Isaac's)
   Worker webmcp-sdk-docs                production    https://webmcp-sdk-docs.<sub>.workers.dev
   Worker webmcp-sdk-docs-pr-<n>         dynamic mode  https://webmcp-sdk-docs-pr-<n>.<sub>.workers.dev
   Worker webmcp-sdk-docs-staging        staging mode
   Worker webmcp-sdk-docs-state          Alchemy state, production   (bearer token: env docs-production)
   Worker webmcp-sdk-docs-preview-state  Alchemy state, previews     (bearer token: env docs-preview)
   Worker better-upload-site*            Better Upload, other repository, other tokens (§4.1)
```

**Hosting: Workers static assets, not Pages.** Cloudflare's own guidance is "Start new projects with Workers" ([Pages docs](https://developers.cloudflare.com/pages/)). Static-asset requests are free and unlimited ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). The site Worker is **assets-only**: no script is uploaded, so no request ever invokes code, counts as a Worker request (free and unlimited on Free and Paid plans alike).

**Routing** ([SSG and 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)): `html_handling: drop-trailing-slash` (`/guide` serves `guide.html` or `guide/index.html`, `/guide/` redirects to `/guide`: the site's links, canonical URLs and sitemap have no trailing slash), `not_found_handling: 404-page` (unknown paths get `404.html` with status 404).

**Headers**: the kit's rules (nosniff, referrer policy, noindex off production, `X-Delivery-Revision`) plus WebMCP's `site.headers` in [`delivery.config.json`](../delivery.config.json), merged by the kit into one block per URL pattern (a repeated pattern makes Cloudflare reject the whole `_headers` file) and checked by the deploy smoke test. The CSP allows `'unsafe-inline'` scripts because the prerendered TanStack Start pages inline their serialized router state and the theme anti-flash script (no per-request nonce on a static site); it was verified with zero violations in Playwright under workerd on the real build. Headers belong to the reviewed configuration, not to site content:

| Header | Value | Why |
| - | - | - |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Same-origin only. `'unsafe-inline'` for scripts is forced by the prerendered TanStack Start pages (inline serialized router state for hydration, plus the theme script; no per-request nonce on a static site). Verified with zero CSP violations in Playwright under workerd on the real build (pages, client navigation, search, 404). Still blocks third-party scripts, plugins, framing, `<base>` hijack and fetch-based exfiltration. Hash-based policy: §8 |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | `.dev` is HSTS-preloaded already; matters for a custom domain. No `preload` (domain owner's decision) |
| `X-Content-Type-Options` / `X-Frame-Options` | `nosniff` / `DENY` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, … all `()` | a docs site needs none |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | process isolation; no hotlinking by other sites |
| `X-Robots-Tag` | `noindex, nofollow` | staging, previews and local stages only |
| `X-Delivery-Revision` | `pr-6@abc1234` | staging and previews only: which PR and commit the Worker currently serves |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | content-hashed files (Vite's output dir in `apps/docs`). Deliberately not `/__tsr/*` (client-navigation data named after the function and its arguments, not the content). Everything else keeps Cloudflare's default `public, max-age=0, must-revalidate` + ETag, so a deploy is visible immediately |

Changing the CSP (for example to embed a third-party demo) is an infra PR, reviewed like any security change.

**Why the infra lives in `infra/site` (not `apps/docs/alchemy.run.ts`):** the deploy jobs check out *only* the infra package and install *only* its dependencies (`pnpm --filter @senon/webmcp-sdk-docs-infra install`, 126 packages, none of the site's toolchain). Keeping it out of the site package makes that separation physical: no site dependency, MDX plugin or TanStack Start/Vite code is installed in a job that holds a Cloudflare token. It also keeps the site thread and the infra changes in separate files.

**Alchemy v2** (`alchemy@2.0.0-beta.85`, `@alchemy.run/cloudflare@2.0.0-beta.85`, `effect@4.1.2`, all exact pins): an Effect-based TypeScript IaC framework ([alchemy.run](https://alchemy.run/getting-started)). The stack is [`infra/site/alchemy.run.ts`](../infra/site/alchemy.run.ts): one `Cloudflare.Worker` with `assets`, `workersDev: { enabled: true, previewsEnabled: false }` (no per-version preview URLs that would keep every old build public), observability off (nothing executes). Alchemy v2 is still a **beta** on npm's `latest` tag: pinned exactly, grouped in Dependabot (`docs-infra`), with an escape hatch (§8).


### 2.1 Pipeline (kit contract, WebMCP values)

- **Why two workflows:** a `pull_request` run uses the workflow file from the PR, so deploy jobs there could be edited by a PR. `workflow_run`, `schedule` and `workflow_dispatch` always run the default branch's file, and both environments only serve `main`.
- **Untrusted inputs:** only the run id comes from the event; the run, the PR (resolved by head SHA + same repository, re-checked open / head == SHA) and main's head are read from the API. The artifact is a ZIP extracted by the kit's hardened `unzip.ts` (no symlinks, no absolute or `..` paths, bounded count and size, CRC), its `manifest.json` must equal the recomputed sha / pr / stage, and it is only uploaded, never executed.
- **Preview gate** (`previews.gateChecks`, kit D13, a policy shared with Better Upload): **`docs-build` only**, green on the exact SHA. It fails closed on missing / skipped / neutral / timeout (40 min).
  - **Why this job:** it builds the site, checks the manifest and the artifact, and smoke-tests it locally without credentials. That is what proves the artifact is valid and safe to upload.
  - **Not waited on:** `checks`, `browser`, `workflow-lint`, `docs` and e2e. The deploy runs main's workflow and infra code, never the PR's, and PR code never sees a secret. Those checks protect the merge, not the preview, and a preview is an input to QA, not its result.
- **Production gate** (`previews.requiredChecks`, unchanged): `checks`, `browser`, `workflow-lint` and `docs-build`, green on main's exact SHA. PR #6 adds `docs`.
  - **`dependency-review`** stays required by the ruleset but is not in the gate, because it is PR-only.
  - npm releases are independent of both gates.
- **Lifecycle** (automatic, no human approval, kit D13):
  - every open same-repository PR gets a preview, **drafts included**;
  - `closed` (merged or not) tears down, and a reopen redeploys;
  - one concurrency group per PR, never cancelled;
  - the PR is re-read before and after the deploy and before the comment.
- **Exceptions, stated in the PR comment:**
  - forks never get a preview (untrusted code, no secret);
  - Dependabot/Renovate PRs are built only, unless `DOCS_PREVIEW_DEPENDABOT=true`.
- **Cleanup, independent of CI:**
  - the `closed` run is the fast path;
  - an **hourly sweep** (`23 * * * *`) removes every `webmcp-sdk-docs-pr-<n>` Worker and `pr-<n>` stage whose PR is no longer eligible, re-checking the PR just before each removal;
  - the sweep only matches the exact `webmcp-sdk-docs-pr-<n>` pattern, never production, the state stores or another project's Workers;
  - a failed removal raises an `::error::`, turns the job red and posts a "removal failed, will retry" comment; the next hour retries.
- **PR comment:** one comment, updated in place.
  - Deploy: building → deploying → deployed (URL + SHA), or failed (run link).
  - Cleanup: removed, or removal failed.
  - Exceptions: not deployed (fork / bot).
- **`preflight`** runs before any Cloudflare call. It checks:
  - the token is account-owned and belongs to this account;
  - the state-store token and API version;
  - the Workers visible to the token;
  - a preview token may reach production only if `docs-preview` is main-only, which is required. A reviewer there is reported as policy drift and never blocks cleanup.
- **Hygiene:** `permissions: {}`, least privilege per job, SHA pins, no cache in the build whose artifact ships nor in any privileged job, only `infra/site` dependencies from main's frozen lockfile in privileged jobs; zizmor pedantic (one justified `dangerous-triggers` suppression on `workflow_run`), actionlint and the kit's workflow invariants (`tooling/check-workflows.mjs`, W1–W11, run in `checks`).

### 2.2 Kit divergences (to upstream or decide)

Kit v0.1.4 absorbed every adaptation the first adoption needed (project headers as `site.headers`, no cache in `docs-build`, local-check scope, the production `steps.fresh` fix, `deploy-comment` concurrency, rollback gate, portable tests); v0.1.5 adds only generic fixes. What remains:

| # | Where | Divergence | Reason |
| - | - | - | - |
| L1 | `release.yml`, `tooling/release/*` | not vendored: WebMCP's release kept (`vendor.mjs` ≥ v0.1.1 keeps an existing release); one line added, `cache-mode: none` on `finalize` (kit invariant W10), the rest byte-identical | WebMCP's flow (dispatch + `confirm_version`, version-PR change-note check, stage publish via OIDC, owner 2FA on npm, local tarball comparison, idempotent finalize, `release-finalize` reviewer) is the reference the kit converges on in v0.2.0; npm trust is bound to the file name `release.yml` + environment `npm-release`, not to the file's content |
| L7 | `infra/site/package.json` | name `@senon/webmcp-sdk-docs-infra` (JSON, no comment possible) | the template name `@example/site-infra` |

No `local:` patch remains in any vendored file. Project-owned (not divergences): `delivery.config.json`, `tooling/docs-site-build.mjs` (+ `tooling/docs-placeholder/` until `apps/docs` exists), `tooling/docs-delivery.test.ts`, `ci.yml`.

## 3. Tokens: exact permissions

All are **account-owned** (Manage Account → API Tokens), **custom** tokens, with an expiration. No zone permission, no Secrets Store permission in CI.

**Temporary bootstrap token** (`docs-bootstrap-temp`, expiration 1 day; used once by the agent, then **deleted**):

| Permission | Scope | Level | Why |
| - | - | - | - |
| Workers | All Workers | Admin | create the state-store Workers and the `webmcp-sdk-docs` / `webmcp-sdk-docs-staging` Workers |
| Account Secrets Store | Account | Edit | Alchemy's store bootstrap writes the store's bearer token and key there, and reads the token back |

**`github-docs-production`** → environment `docs-production`:

| Resource | Before narrowing | After (final) |
| - | - | - |
| Worker `webmcp-sdk-docs` | — (created by the bootstrap token) | **Editor** (Individual Workers) |
| any other Worker, incl. Isaac's other projects and the state stores | none | none |
| Secrets Store, zones, account settings | none | none |

**`github-docs-staging`** → environment `docs-preview` (mode `staging`):

| Resource | Before narrowing | After (final) |
| - | - | - |
| Worker `webmcp-sdk-docs-staging` | — (created by the bootstrap token) | **Editor** (Individual Workers) |
| Worker `webmcp-sdk-docs` (production), all others | none | none |
| Secrets Store, zones | none | none |

The two CI tokens are created *after* the bootstrap (the Workers must exist for per-Worker scopes), so they never need a narrowing step: only the temporary token is broad, and it is deleted.

**`github-docs-preview-dynamic`** → environment `docs-preview` (mode `dynamic` only, instead of `github-docs-staging`):

| Resource | Level |
| - | - |
| Workers (All Workers) | **Admin** (creates and deletes `webmcp-sdk-docs-pr-<n>`) |
| Secrets Store, zones | none |

❓ Fallback if a per-Worker Editor deploy fails with 403 on the assets upload session (§1): replace that token's scope with Workers → All Workers → **Editor**. `preflight` then sees the staging token reaching production and **refuses to deploy staging unless `docs-preview` is main-only**.

**GitHub** (per environment): secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DOCS_STATE_TOKEN` (the store bearer token written by the bootstrap). Repository variables: `DOCS_WORKERS_SUBDOMAIN`, `DOCS_PREVIEW_MODE`, `DOCS_DEPLOY_ENABLED`.

## 4. Preview modes and residual risks

| | `staging` (code default) | `dynamic` (**chosen**) |
| - | - | - |
| What PRs get | the shared Worker `webmcp-sdk-docs-staging`; last PR deployed wins | one Worker per PR (drafts included), removed on close, hourly sweep |
| Preview token | Editor on `webmcp-sdk-docs-staging` only | Admin on **all** Workers of the account |
| Approval / guard | none needed (unless the token turns out broader, see fallback) | `docs-preview` must be **main-only** (branch policy); `preflight` refuses otherwise. No reviewer (automatic previews, decided by Isaac on 2026-11-22) |
| Production Worker reachable by the preview token? | **no** | **yes**: it can overwrite or delete `webmcp-sdk-docs`, the state-store Workers and **every other Worker of the account, including Better Upload's** (§4.1) |
| Production state reachable? | no (separate store and bearer token) | no (same), but the token could delete the production state-store Worker |

Residual risks:

| Holder of… | Can do | Cannot do |
| - | - | - |
| production token | deploy any content to `webmcp-sdk-docs`, roll it back, change its settings | create/delete Workers, touch staging, other Workers, Secrets Store, zones |
| production store token (`DOCS_STATE_TOKEN`, docs-production) | read/write/delete production *state* records (Alchemy may then mis-plan; no Cloudflare resource changes by itself) | call the Cloudflare API |
| staging token | deploy any content to staging | touch production or any other Worker; create/delete |
| preview store token | read/write staging/preview state | production state |
| dynamic token | **anything on every Worker of the account**: overwrite or delete this production, its state Workers, **Better Upload's `better-upload-site*` Workers** and any other project | Secrets Store, zones |
| a writer with a same-repo PR (edits `docs.yml` or adds a workflow in the PR) | run arbitrary code **without secrets** (the PR's `docs` run is unprivileged); its artifact is data, validated | read `docs-preview` or `docs-production` secrets: `docs-deploy.yml` runs main's definition, and both environments only serve `main` |
| a writer who merges to `main` | change `docs-deploy.yml` and therefore everything (reviewed PR + required checks) | bypass the ruleset |
| a fork PR | its `docs` run builds without secrets; `docs-deploy` plans `skip` (head repository is not this one) | anything else |
| Dependabot | build only (no preview unless `DOCS_PREVIEW_DEPENDABOT=true`) | |
| temporary bootstrap token, while it exists | everything on Workers; create/edit/delete/bind **any secret of the account's Secrets Store** | (expires after 1 day; delete it right after the bootstrap) |

Why dynamic mode is acceptable now: the account-wide token lives only in `docs-preview`, which (after §6.0) releases secrets to runs on `main` only, and only `docs-deploy.yml` (main's definition) uses it; PR code never runs in those jobs. Isaac dropped the required reviewer on 2026-11-22 (automatic previews, a common kit policy). A click would not have reduced what the token can do once a run has it: a compromise of main's infra code or of its locked dependencies would reach every Worker of the account.

### 4.1 Shared account with Better Upload

The account also hosts Better Upload's site (`better-upload-site`, `better-upload-site-pr-<n>`, its own state stores), deployed from its own repository with its own tokens. Names follow the common pattern `<project>-<site>[-pr-<n>|-staging]` and `<project>-<site>[-preview]-state`, but **names are conventions, not IAM boundaries**:

- this repository's per-Worker tokens (production, staging) cannot touch Better Upload's Workers, and vice versa;
- each repository's **dynamic** preview token is account-wide Workers Admin: WebMCP's can modify or delete Better Upload's production and state Workers, and Better Upload's can do the same to `webmcp-sdk-docs*`.

Mitigations, per repository: the token is only reachable from main-defined jobs (`workflow_run`/schedule/dispatch); the environment is main-only; optional required reviewer; **separate tokens per repository** (revoking one does not touch the other; the Cloudflare audit log names the token); 1-year expiry. If that residual risk is not acceptable for one project, switch it to `staging` mode (per-Worker token).

## 5. Threat model delta (vs [`02-threat-model.md`](release-research/02-threat-model.md))

| # | Threat | Controls | Residual |
| - | - | - | - |
| **T13'** | Malicious docs deploy / defacement | production token only in env `docs-production` (branch policy `main`, no admin bypass) ⇒ needs a merged PR; scoped to `webmcp-sdk-docs` only; staging token scoped to staging only; deploy jobs only in main-defined `docs-deploy.yml` (`workflow_run`, schedule, dispatch), both environments main-only, dynamic mode also behind an optional reviewer; no `pull_request_target`; no fork deploys; Dependabot build-only; gate on every required check of the SHA; PR resolved and re-checked from the API | a merged malicious change deploys (rollback §7) |
| **T17'** | Docs build compromise | build job has no secret, no write token, no cache; deploy jobs never install site deps (current main's infra only); artifact fetched as a ZIP and extracted by a validating extractor (zip-slip, symlinks, bombs, CRC), manifest compared with recomputed values, `check-site` (credential files, limits); headers/redirects from infra | a compromised build serves malicious static content; CSP limits it to same-origin script |
| T20 | Cloudflare token theft | per-environment, per-Worker, account-owned, expiring tokens; never passed to steps other than `preflight`/`alchemy`; no caches | see §4 per token |
| T21 | State tampering / leak | state over HTTPS with per-store bearer tokens; separate production and preview stores; CI cannot create/upgrade stores; `preflight` checks token-store match and API version | a stolen store token can corrupt that store's records (detected as plan anomalies; recover by re-adopting) |
| T22 | Preview abuse | `noindex`, `X-Delivery-Revision`, staging/previews only from writers' PRs | previews are public; same registrable domain (`<sub>.workers.dev`) as production, but the site sets no cookies |
| T23 | Alchemy supply chain | exact pins, lockfile, release-age and cooldown policy, `docs-infra` Dependabot group, telemetry off | bounded by the token scopes above |
| T24 | Stale or unchecked deploy | gate, PR re-read before/after deploy and before the comment, head-of-main checks, per-PR serialisation, idempotent teardown, smoke byte comparison | anyone with write access can dispatch a rollback |
| T25 | `workflow_run` misuse (privileged run fed by an untrusted run) | only the run id is taken from the event; run, PR and main's head re-read from the API; fork runs skipped; artifact treated as data; no checkout of the triggering run's code | a bug in the plan/extract code is the attack surface; covered by unit tests (deploy-plan, unzip) |

## 6. One-time setup

Isaac does only what needs his login, his 2FA or his decision; an agent runs the rest from an up-to-date `main` with `gh` logged in as a repository admin. No token in chat, argv, logs or shell history. Generic steps: kit `docs/bootstrap.md` §1–§4.

### 6.0 Merge order and GitHub settings

1. Merge **#7**. `docs-deploy.yml` is on `main` from then on; deploys stay off.
2. Right after the merge: `docs-preview` → deployment branches: keep **`main`**, delete **`refs/pull/*/merge`** (`gh api -X DELETE repos/PaulSenon/webmcp-sdk/environments/docs-preview/deployment-branch-policies/66401983`); admin bypass stays off; no reviewer (removed 2026-11-23, automatic previews). `docs-production` is already `main` only.
3. Rebase **#6** onto `main` (regenerate the lockfile). It adds its `docs` CI job; add `docs` to `previews.requiredChecks` in `delivery.config.json` in that PR, and the root `docs:build` script; `tooling/docs-site-build.mjs` then builds the real site.
4. After #6 is merged: ruleset `main` gains required checks **`docs`** and **`docs-build`**. Never `docs-preview` (commit status) or a `deploy-*` job.

### 6.1 Isaac only

1. **Log in, 2FA:** <https://dash.cloudflare.com/login> → *My Profile* → **Authentication**.
2. **Account ID and workers.dev subdomain:** Cmd/Ctrl-K → *Copy account ID*; **Workers & Pages** → *Account Details*.
3. **Temporary bootstrap token:** **Manage Account → API Tokens → Create Token → Custom**: *Workers: Admin (All Workers)* + *Account Secrets Store: Edit*, expiration tomorrow; hand it over through the agent's secure file card (T3 `request_secret`, `delivery: "file"`).
4. **After the bootstrap**, the two CI tokens it prints: `github-docs-production` = Workers → Specified Workers → `webmcp-sdk-docs` → **Editor**; preview (dynamic mode) = Workers → All Workers → **Admin**. Expiration 1 year, handed over the same way. Then **delete the temporary token**.
5. Turn deploys on when ready: `gh variable set DOCS_DEPLOY_ENABLED --body true`.

### 6.2 Agent

```sh
node infra/site/scripts/bootstrap.ts --account-id <id> --token-file "$TEMP" --out-dir "$PRIVATE" --subdomain <sub> --check
node infra/site/scripts/bootstrap.ts --account-id <id> --token-file "$TEMP" --out-dir "$PRIVATE" --subdomain <sub>
# GitHub: dry run, read it, then --apply. --no-ruleset: WebMCP keeps its own ruleset.
node tooling/setup-github.mjs --repo PaulSenon/webmcp-sdk --reviewer PaulSenon --preview-reviewer --no-ruleset \
  --account-id <id> --subdomain <sub> --prod-token-file "$PROD" --preview-token-file "$PREVIEW" --state-dir "$PRIVATE" --preview-mode dynamic
rm -rf "$PRIVATE" "$TEMP" "$PROD" "$PREVIEW"
```

`setup-github.mjs` (re)writes `docs-preview` / `docs-production` (main only), the env secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DOCS_STATE_TOKEN`, the variables `DOCS_WORKERS_SUBDOMAIN` / `DOCS_PREVIEW_MODE`, and the release environments: check in the dry run that `npm-release` (branches `main`, `next`) and `release-finalize` (reviewer PaulSenon) match today's settings before `--apply`. Verify: push to #6 → `deploy-plan` = preview, `deploy-preview` green, the PR comment and the `docs-preview` status carry the URL, `curl -sI <url>` shows `X-Delivery-Revision` and the CSP.

## 7. Operations

| Situation | Do |
| - | - |
| Bad content in production, now | Cloudflare dashboard → **Workers & Pages** → `webmcp-sdk-docs` → **Deployments** → previous version → **Rollback** (instant). Then fix forward on `main` (revert PR) |
| Roll back to a given commit | Actions → **docs-deploy** → *Run workflow* on `main`, `rollback_run_id` = id of a successful **docs** run of that commit on main. CLI: `gh workflow run docs-deploy.yml --ref main -f rollback_run_id=<id>` |
| Redeploy production from main | Actions → **docs** → *Run workflow* on `main` (rebuild); `docs-deploy` follows |
| Reset staging to `main` | re-run the latest docs run of any open PR, or wait for the next PR push (staging is never torn down) |
| Dynamic mode: a preview was not removed | the hourly sweep retries it (red job + PR comment until it succeeds), or **docs-deploy** → *Run workflow* with `destroy_pr` = PR number (or `sweep`) |
| A PR got no preview | read the `deploy-plan` summary: it states the reason (fork, draft, Dependabot, superseded, build failed, no artifact, checks) |
| A deploy fails at *Gate* | a required check of that commit failed or is missing after 40 min: fix or re-run it, then re-run the deploy job |
| `preflight` fails | the message names the cause: user token instead of account token, wrong `DOCS_STATE_TOKEN` for the environment, store version behind Alchemy (re-run the bootstrap with a new temporary token), Worker missing or not in the token's scope, preview-side token reaching production while `docs-preview` is neither main-only nor reviewer-protected |
| Alchemy upgrade (Dependabot `docs-infra` PR) | review as untrusted; if the state API version changes, `preflight` fails until the stores are upgraded: run the bootstrap again (temporary token), then delete the token |
| Token leaked | Manage Account → API Tokens → **Roll** or **Delete**; update the env secret; review *Audit Logs*. Store token leaked: re-bootstrap the store with `--force` is not exposed; instead delete the store's token secret in Secrets Store and re-run the bootstrap (it recreates the missing secret) |
| Rotate yearly | Roll the CI tokens, hand over as in §6.1, `gh secret set … < file` |
| Inspect state | `SITE_STATE=cloudflare SITE_STATE_STORE=<store> SITE_ALLOW_LOCAL_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=… pnpm exec alchemy state list` with a temporary token. Never `alchemy destroy` with these variables |

### Custom domain later (D12, off by default)

1. The zone must be in the same account (Isaac's existing zone, or *Add a site*).
2. In `alchemy.run.ts`, for `production` only: `domain: "docs.<domain>"`.
3. Production token: add **Zone → Workers Routes → Edit** scoped to that **one zone** ([routes and custom domains](https://developers.cloudflare.com/workers/authorization/workers/#routes-and-custom-domains)). Nothing for staging.
4. `SITE_URL` and the smoke URL: a small change in `docs.yml` and `src/stage.ts`. HSTS `preload` only once every subdomain is HTTPS forever.

## 8. Deferred (proposals, not implemented)

1. **Hash-based CSP** (per-page `<meta>` CSP with script hashes, removing `'unsafe-inline'`).
2. **Cloudflare Access on staging/previews** (staging visible only to Isaac); adds an Access application and token permission.
3. **Drift detection** and an uptime check of production.
4. **Escape hatch** if Alchemy v2 stalls: deploy the same artifact with Wrangler, same tokens and workflow.
5. **Versioned docs** (D8) once there is a release.

## 9. Sources (checked 2026-11-14)

- Cloudflare: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [create account](https://developers.cloudflare.com/fundamentals/account/create-account/), [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/), [roles overview](https://developers.cloudflare.com/workers/authorization/), [granular per-Worker permissions, 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/), [Durable Objects permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/), Workers API reference ([upload script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/), [delete script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/), [assets upload session](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/), [deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/), [script subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/), [account subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/)), [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/), [account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), [create a token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [SSG and 404](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/), [Pages → Workers](https://developers.cloudflare.com/pages/).
- Alchemy `2.0.0-beta.85` source: `alchemy/src/State/HttpStateStore.ts` (`makeHttpStateStore`), `@alchemy.run/cloudflare/src/StateStore/State.ts` (`loginWithCloudflare`, `readSecretViaEdge`, credentials cached outside CI), `Alchemist/State.ts` (`bootstrapConfigured`: `updateStateStore: true`), `Workers/WorkerProvider.ts` (`CLOUDFLARE_WORKERS_SUBDOMAIN`); docs: [state store](https://alchemy.run/state-store), [CI](https://alchemy.run/environments/ci), [profiles and CI variables](https://alchemy.run/environments/profiles).
- GitHub: [workflow_run (runs the default branch's workflow; `pull_requests` empty for forks)](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [artifacts API (download as ZIP)](https://docs.github.com/en/rest/actions/artifacts), [commit statuses](https://docs.github.com/en/rest/commits/statuses), [deployment branch policies](https://docs.github.com/en/rest/deployments/branch-policies), [pull_request activity types; no secrets for forks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [check runs API](https://docs.github.com/en/rest/checks/runs), [environments API](https://docs.github.com/en/rest/deployments/environments), [environment branch policies on `refs/pull/<n>/merge`](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/).
- Verified locally without an account: `alchemy dev` serves an assets-only Worker in workerd with the `_headers` rules; `alchemy plan` needs credentials; `DOCS_STATE=http` reaches the store over HTTPS (transport error against a non-existent store) and the stage/store guard refuses a mismatch; `state bootstrap` runs non-interactively up to the account-access check.

