# Docs site deployment

Maintainer runbook for the documentation site (`apps/docs`) on Cloudflare, in **one Cloudflare account** (Isaac's existing one). It covers the verified Cloudflare/Alchemy facts the design rests on, the architecture, the tokens and what each one can do, the residual risks per preview mode, the one-time setup split between Isaac and an agent, and operations.

- Infrastructure as code: [`infra/docs`](../infra/docs) (Alchemy v2, private workspace package `@senon/webmcp-sdk-docs-infra`).
- Pipeline: [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) (unprivileged: build, check, artifact) and [`.github/workflows/docs-deploy.yml`](../.github/workflows/docs-deploy.yml) (privileged, main-defined: deploy, teardown, sweep, rollback).
- **Deploys are off** until the repository variable `DOCS_DEPLOY_ENABLED` is `true` (§6). Until then only `docs` runs, without credentials.
- **Preview mode:** Isaac chose `DOCS_PREVIEW_MODE=dynamic` (2026-11-14; a per-PR Worker). `staging` stays available and is the code default when the variable is unset (§4).
- **Shared account:** the same Cloudflare account also hosts Better Upload's site (`better-upload-site*`), deployed by another repository with its own tokens (§4.1).

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
 docs.yml  (pull_request ×6 types, push main, dispatch) ─ UNPRIVILEGED, runs PR code, no secret
   docs-build      install ─ SITE_URL=<stage URL> pnpm docs:build ─ check-site ─ local workerd smoke
                   ─ artifact docs-site-<stage> = { manifest.json {sha, pr, stage, event, action}, site/ }
   docs-lifecycle  no-op on closed / converted_to_draft (so the run completes and triggers docs-deploy)
        │ workflow_run: completed  (docs-deploy.yml always runs main's definition)
        ▼
 docs-deploy.yml ─ PRIVILEGED, main-defined; environments docs-preview / docs-production (main only)
   docs-deploy-plan        read the run, resolve + verify the PR from the API (head SHA, same repo),
   (no secret)             plan: deploy-preview | teardown-preview | deploy-production | skip;
                           GATE: every required check of the SHA green
   docs-deploy-preview     PR still head/open/ready? fetch artifact ZIP → safe extract → manifest ==
                           recomputed → PR re-check → preflight → alchemy deploy → smoke →
                           closed/drafted meanwhile? destroy
   docs-teardown-preview   still closed/draft? (reopen keeps it) → idempotent alchemy destroy
   docs-deploy-report      stable PR comment (marker) + commit status `docs-preview` (not required)
   docs-deploy-production  head of main? artifact → preflight → deploy → smoke  | rollback_run_id
   docs-sweep-previews     weekly / dispatch: destroy pr-<n> of closed, draft or deleted PRs

 One Cloudflare account (Isaac's)
   Worker webmcp-sdk-docs                assets only   https://webmcp-sdk-docs.<sub>.workers.dev
   Worker webmcp-sdk-docs-staging        assets only   https://webmcp-sdk-docs-staging.<sub>.workers.dev
   Worker webmcp-sdk-docs-pr-<n>         dynamic mode only
   Worker webmcp-sdk-docs-state          Alchemy state, production   (bearer token: env docs-production)
   Worker webmcp-sdk-docs-preview-state  Alchemy state, staging/PRs  (bearer token: env docs-preview)
   …Isaac's other Workers: untouched by every per-Worker token
```


**Hosting: Workers static assets, not Pages.** Cloudflare's own guidance is "Start new projects with Workers" ([Pages docs](https://developers.cloudflare.com/pages/)). Static-asset requests are free and unlimited ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). The site Worker is **assets-only**: no script is uploaded, so no request ever invokes code, counts as a Worker request (free and unlimited on Free and Paid plans alike).

**Routing** ([SSG and 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)): `html_handling: drop-trailing-slash` (`/guide` serves `guide.html` or `guide/index.html`, `/guide/` redirects to `/guide`: the site's links, canonical URLs and sitemap have no trailing slash), `not_found_handling: 404-page` (unknown paths get `404.html` with status 404).

**Headers** are rendered by [`infra/docs/src/headers.ts`](../infra/docs/src/headers.ts) as a `_headers` file and passed in the Worker's asset config, which overrides any `_headers`/`_redirects` in the build output ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)). Headers belong to the reviewed infra package, not to site content:

| Header | Value | Why |
| - | - | - |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Same-origin only. `'unsafe-inline'` for scripts is forced by the prerendered TanStack Start pages (inline serialized router state for hydration, plus the theme script; no per-request nonce on a static site). Verified with zero CSP violations in Playwright under workerd on the real build (pages, client navigation, search, 404). Still blocks third-party scripts, plugins, framing, `<base>` hijack and fetch-based exfiltration. Hash-based policy: §8 |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | `.dev` is HSTS-preloaded already; matters for a custom domain. No `preload` (domain owner's decision) |
| `X-Content-Type-Options` / `X-Frame-Options` | `nosniff` / `DENY` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, … all `()` | a docs site needs none |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | process isolation; no hotlinking by other sites |
| `X-Robots-Tag` | `noindex, nofollow` | staging, previews and local stages only |
| `X-Docs-Revision` | `pr-6@abc1234` | staging and previews only: which PR and commit the Worker currently serves |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | content-hashed files (Vite's output dir in `apps/docs`). Deliberately not `/__tsr/*` (client-navigation data named after the function and its arguments, not the content). Everything else keeps Cloudflare's default `public, max-age=0, must-revalidate` + ETag, so a deploy is visible immediately |

Changing the CSP (for example to embed a third-party demo) is an infra PR, reviewed like any security change.

**Why the infra lives in `infra/docs` (not `apps/docs/alchemy.run.ts`):** the deploy jobs check out *only* the infra package and install *only* its dependencies (`pnpm --filter @senon/webmcp-sdk-docs-infra install`, 126 packages, none of the site's toolchain). Keeping it out of the site package makes that separation physical: no site dependency, MDX plugin or TanStack Start/Vite code is installed in a job that holds a Cloudflare token. It also keeps the site thread and the infra changes in separate files.

**Alchemy v2** (`alchemy@2.0.0-beta.85`, `@alchemy.run/cloudflare@2.0.0-beta.85`, `effect@4.1.2`, all exact pins): an Effect-based TypeScript IaC framework ([alchemy.run](https://alchemy.run/getting-started)). The stack is [`infra/docs/alchemy.run.ts`](../infra/docs/alchemy.run.ts): one `Cloudflare.Worker` with `assets`, `workersDev: { enabled: true, previewsEnabled: false }` (no per-version preview URLs that would keep every old build public), observability off (nothing executes). Alchemy v2 is still a **beta** on npm's `latest` tag: pinned exactly, grouped in Dependabot (`docs-infra`), with an escape hatch (§8).

### Stages

| Stage | Worker | State store | Who |
| - | - | - | - |
| `production` | `webmcp-sdk-docs` | `webmcp-sdk-docs-state` | CI, `main` only, env `docs-production` |
| `staging` | `webmcp-sdk-docs-staging` | `webmcp-sdk-docs-preview-state` | CI, same-repo non-draft PRs, mode `staging`, env `docs-preview`; never torn down |
| `pr-<n>` | `webmcp-sdk-docs-pr-<n>` | `webmcp-sdk-docs-preview-state` | CI, mode `dynamic` only; destroyed on close or conversion to draft |
| anything else (`live_$USER`, `dev_$USER`, …) | `webmcp-sdk-docs-<stage>` | local `.alchemy/` (gitignored) | developers |

`DOCS_STATE` selects the state: `local` (default), `http` (CI), `cloudflare` (bootstrap). The stack refuses a remote stage with local state and the reverse, a stage whose store is not the expected one (`production` ↔ production store; `staging`/`pr-<n>` ↔ preview store), and remote state outside GitHub Actions unless `DOCS_ALLOW_LOCAL_REMOTE=1` (needed because `alchemy destroy` does not run the stack program). `prod`, `stage`, `pr-x`, `pr-01` and names containing `state` are reserved. These guards stop mistakes; the token scopes are what stop attacks.

Local development, no Cloudflare account needed:

```sh
pnpm docs:build                                       # apps/docs/out
cd infra/docs && pnpm dev                             # alchemy dev: the build in local workerd with production headers
DOCS_SITE_DIR=../../apps/docs/out pnpm check:local    # the check CI runs: local workerd + smoke test
```

### Pipeline

Two workflows, because a `pull_request` run uses the workflow file **from the PR**: if deploy jobs lived there, a same-repository PR could edit them and read the deploy secrets (only a reviewer would stop it). Now no job that holds a secret is defined by a PR.

| Workflow / job | Trigger | Holds | Runs PR code? |
| - | - | - | - |
| `docs` / `docs-build` | PR opened, synchronize, reopened, ready_for_review (**drafts included**); push to `main`; dispatch | read-only token | **yes** (site build) |
| `docs` / `docs-lifecycle` | PR closed or converted_to_draft (no-op) | nothing | no |
| `docs-deploy` / `docs-deploy-plan` | `workflow_run` of `docs` completed | `actions`/`pull-requests`/`checks`/`contents: read` | no (main's `infra/docs`, no dependency installed) |
| `docs-deploy` / `docs-deploy-preview` | plan = deploy-preview | env `docs-preview`: Cloudflare token + preview store token | no: main's infra, the artifact as data |
| `docs-deploy` / `docs-teardown-preview` | plan = teardown-preview (dynamic), or dispatch `destroy_preview` | env `docs-preview` | no |
| `docs-deploy` / `docs-deploy-report` | after a preview deploy or teardown | `pull-requests: write`, `statuses: write` | no |
| `docs-deploy` / `docs-sweep-previews` | weekly cron or dispatch `sweep_previews` (dynamic) | env `docs-preview` | no |
| `docs-deploy` / `docs-deploy-production` | plan = deploy-production (push or dispatch run of `docs` on main), or dispatch `rollback_run_id` | env `docs-production` | no |

- **Untrusted inputs.** From the `workflow_run` event only the run id is used. The run (event, head SHA, branch, repository, conclusion, path), the PR and main's head are read from the API. The PR is resolved from candidates (the payload's `pull_requests` hint, which is empty for forks; PRs whose head branch is the run's branch; PRs of the commit) and accepted only if its head is **this SHA in this repository, into this repository**; two different matching PRs are refused ([`src/deploy-plan.ts`](../infra/docs/src/deploy-plan.ts)). The plan is a reconciliation on the PR's **current** state: open, ready, head == SHA, green build → deploy; closed (merged or not) or draft → teardown (dynamic); otherwise skip. Forks never deploy (`head_repository` ≠ this repository).
- **Artifact.** Downloaded as a ZIP through the artifacts API (no download action) and extracted by [`src/unzip.ts`](../infra/docs/src/unzip.ts) into a fresh directory under `runner.temp`: entry names must be relative with no `..`, empty or `.` segment, backslash, drive letter or control character; no symlink or special file; no encryption, ZIP64 or multi-disk; bounded entry count (25,000), file size (25 MiB) and total (512 MiB, zip-bomb safe), CRC and size verified, never overwriting. `manifest.json` must have exactly `sha, pr, stage, event, action` with `sha`/`pr`/`stage` equal to the recomputed values; `site/` then goes through `check-site`. The content is only uploaded to Cloudflare, never executed.
- **Drafts.** A draft builds and is checked but gets no preview; `ready_for_review` deploys. In dynamic mode `converted_to_draft` tears down like `closed`; in staging mode nothing is torn down.
- **Dependabot.** Build only, no preview, unless the repository variable `DOCS_PREVIEW_DEPENDABOT` is `true`.
- **Deploy gate** ([`src/gate.ts`](../infra/docs/src/gate.ts), one configurable list): `checks`, `browser`, `workflow-lint`, `docs` (ci.yml) and `docs-build` (docs.yml) must all be green for that exact SHA. Check-runs API, newest run per name, `github-actions` app only, at most 40 min; missing, skipped, neutral, failed, cancelled or timeout fails closed. It runs in the plan job (no secret) and again for a rollback commit.
- **Races.** One concurrency group per PR (`docs-deploy-pr-<n>`, never cancelled) for deploy and teardown; production `docs-production`; staging `docs-staging`. The PR is re-read before the deploy, right before it, after it (closed or drafted meanwhile ⇒ destroy) and before the comment (a result for a commit that is no longer the head is not posted). A teardown re-reads the PR and keeps the preview if it was reopened and is ready; the reopen's own run redeploys. Destroy is idempotent. A new push makes older runs no-ops (no PR has their SHA as head).
- **Reporting.** One PR comment (marker `<!-- webmcp-sdk-docs-preview -->`, author `github-actions[bot]`, REST upsert; teardowns update but never create) and a commit status **`docs-preview`** on the PR head SHA (success with the URL, or failure with the run). The status is informational: never make it required.
- **`preflight`** ([`scripts/cli.ts`](../infra/docs/scripts/cli.ts), [`src/isolation.ts`](../infra/docs/src/isolation.ts)), before any alchemy call: active **account** token of this account; `DOCS_STATE_TOKEN` is this stage's store and its API version matches; the production/staging Worker exists and is visible; a preview-side token that **can reach production** (dynamic mode, or an over-broad staging token) is accepted only if `docs-preview` **has a required reviewer or a deployment branch policy of exactly `main`**.
- **zizmor** `dangerous-triggers` is suppressed once, on `workflow_run` in `docs-deploy.yml`, with the justification in that file; everything else is clean under the pedantic persona.
- **No plan without credentials**: Alchemy's plan reads the live account; PRs instead run the build in local workerd with the smoke test. **Smoke test** after every deploy: served `index.html`/`404.html` bytes = artifact, security headers, `noindex` and `X-Docs-Revision` off production, `/assets/*` immutable, clean URLs.
- **Hygiene**: `permissions: {}` at the top of both files, least privilege per job, SHA-pinned actions (GitHub-owned + `pnpm/action-setup`), Alchemy via `pnpm exec`, only `infra/docs` dependencies from main's frozen lockfile in privileged jobs, `persist-credentials: false`, inputs only via `env:`, `cache-mode: none` on every privileged job, zizmor pedantic (also in CI) and actionlint clean, Alchemy telemetry off.

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

❓ Fallback if a per-Worker Editor deploy fails with 403 on the assets upload session (§1): replace that token's scope with Workers → All Workers → **Editor**. `preflight` then sees the staging token reaching production and **refuses to deploy staging unless `docs-preview` has a required reviewer**.

**GitHub** (per environment): secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DOCS_STATE_TOKEN` (the store bearer token written by the bootstrap). Repository variables: `DOCS_WORKERS_SUBDOMAIN`, `DOCS_PREVIEW_MODE`, `DOCS_DEPLOY_ENABLED`.

## 4. Preview modes and residual risks

| | `staging` (code default) | `dynamic` (**chosen**) |
| - | - | - |
| What PRs get | the shared Worker `webmcp-sdk-docs-staging`; last PR deployed wins | one Worker per PR, removed on close/draft, weekly sweep |
| Preview token | Editor on `webmcp-sdk-docs-staging` only | Admin on **all** Workers of the account |
| Approval / guard | none needed (unless the token turns out broader, see fallback) | `docs-preview` must be **main-only** (branch policy) **or** have a required reviewer; `preflight` refuses otherwise. Currently both: reviewer PaulSenon, and main-only after §6.0 |
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

Why dynamic mode is acceptable now: the account-wide token lives only in `docs-preview`, which (after §6.0) releases secrets to runs on `main` only, and only `docs-deploy.yml` (main's definition) uses it; PR code never runs in those jobs. The required reviewer is an optional extra (Isaac currently keeps it): it turns each run into a supervised one. Neither reduces what the token can do once a run has it: a compromise of main's infra code or of its locked dependencies would reach every Worker of the account.

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
| T22 | Preview abuse | `noindex`, `X-Docs-Revision`, staging/previews only from writers' PRs | previews are public; same registrable domain (`<sub>.workers.dev`) as production, but the site sets no cookies |
| T23 | Alchemy supply chain | exact pins, lockfile, release-age and cooldown policy, `docs-infra` Dependabot group, telemetry off | bounded by the token scopes above |
| T24 | Stale or unchecked deploy | gate, PR re-read before/after deploy and before the comment, head-of-main checks, per-PR serialisation, idempotent teardown, smoke byte comparison | anyone with write access can dispatch a rollback |
| T25 | `workflow_run` misuse (privileged run fed by an untrusted run) | only the run id is taken from the event; run, PR and main's head re-read from the API; fork runs skipped; artifact treated as data; no checkout of the triggering run's code | a bug in the plan/extract code is the attack surface; covered by unit tests (deploy-plan, unzip) |

## 6. One-time setup

Isaac does only what needs his login, his 2FA or his decision. An agent (or Isaac with the same commands) does the rest from an up-to-date `main`, with `gh` logged in as a repository admin. No token ever appears in chat, argv, logs or shell history.

### 6.0 Merge order and GitHub settings

1. Merge **#7** (this PR). `docs-deploy.yml` exists on `main` from then on; deploys stay off.
2. Right after the merge, apply the environment settings (coordinator / Isaac; the old `pull_request` deploy jobs are gone, so nothing needs `refs/pull/*/merge` any more):
   - `docs-preview` → **Deployment branches and tags** → *Selected branches and tags*: keep **`main`**, **remove `refs/pull/*/merge`**. Keep *Allow administrators to bypass* **off**. Required reviewer: optional (currently PaulSenon, `prevent_self_review: false`).
   - `docs-production` → already *Selected branches*: **`main`** only, bypass off. No reviewer (continuous deployment).
   - CLI equivalent: `gh api repos/PaulSenon/webmcp-sdk/environments/docs-preview/deployment-branch-policies --jq '.branch_policies[]|[.id,.name]|@tsv'`, then `gh api -X DELETE repos/PaulSenon/webmcp-sdk/environments/docs-preview/deployment-branch-policies/<id of refs/pull/*/merge>`.
   - Check: `preflight` logs `docs-preview: reviewers 1, main-only true`.
3. Rebase **#6** (the site) onto `main`, regenerating the lockfile. Keep both #6's `docs` job and `persona: pedantic` in `ci.yml`.
4. Do 6.1 and 6.2. Then push to #6: its `docs` run completes, `docs-deploy` plans `deploy-preview`, waits for every required check of the head, and deploys **`webmcp-sdk-docs-pr-6`** (dynamic mode); Isaac reviews it there (and approves the job while the reviewer is kept). The PR comment and the `docs-preview` commit status carry the URL.
5. Merging **#6** closes the PR (teardown of `pr-6`) and its push-to-main `docs` run deploys production, again only once every required check of the merge commit is green.
6. Required checks (ruleset, not changed by this PR): add `docs` and `docs-build`. Never `docs-preview` (the commit status) nor any `docs-deploy` job.

### 6.1 Isaac only

1. **Log in, 2FA.** <https://dash.cloudflare.com/login> → *My Profile* → **Authentication** → **Add** (*Mobile App Authentication*, then *Security Key Authentication*); keep the backup codes ([2FA](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/)).
2. **Preview mode**: decided, `dynamic` (§4; `staging` remains possible).
3. **Copy the Account ID**: **Search** (Cmd/Ctrl-K) → *Copy account ID*, or **Workers & Pages** → *Account Details* → **Account ID** ([find IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)). Note the account's **workers.dev subdomain** (`<sub>` in any existing `https://<worker>.<sub>.workers.dev` URL; shown in **Workers & Pages**).
4. **Create the temporary bootstrap token**: **Manage Account → API Tokens → Create Token → Create Custom Token**; name `docs-bootstrap-temp`; permissions *Workers: Admin (All Workers)* and *Account Secrets Store: Edit* (§3); **Token expiration**: tomorrow; **Continue to summary → Create Token**.
5. **Hand it over** through the agent's local secure file card (T3 `request_secret`, `delivery: "file"`), never in chat. The agent runs 6.2 step 1.
6. **Create the two CI tokens** (the bootstrap printed the exact names), same path: `github-docs-production` = *Workers → Specified Workers → `webmcp-sdk-docs` → Editor*; `github-docs-staging` = *Workers → Specified Workers → `webmcp-sdk-docs-staging` → Editor* (in dynamic mode instead: `github-docs-preview-dynamic` = *Workers → All Workers → Admin*). Nothing else. Expiration 1 year. Hand both over through the file card.
7. **Delete the temporary token**: Manage Account → API Tokens → `docs-bootstrap-temp` → **Delete**.
8. Dynamic mode: GitHub → Settings → Environments → `docs-preview`: branch policy **`main` only** (§6.0 step 2); a required reviewer is optional (already set: PaulSenon).

### 6.2 Agent

1. **Bootstrap** ([`infra/docs/scripts/bootstrap.ts`](../infra/docs/scripts/bootstrap.ts), idempotent; `--check` only reads):

   ```sh
   pnpm install --frozen-lockfile
   node infra/docs/scripts/bootstrap.ts --account-id <id> --token-file "$TEMP_TOKEN_FILE" \
     --out-dir "$PRIVATE_DIR" --subdomain <sub>
   ```

   It verifies the token (active, account-owned) and prints only its status/expiry and the account name and ID; confirms the workers.dev subdomain (never changes an existing one); bootstraps the two state stores if absent (non-interactive `alchemy state bootstrap`, throwaway home and working directory, output redacted) and writes their bearer tokens to `$PRIVATE_DIR/<store>.token` (mode 0600); creates `webmcp-sdk-docs` and `webmcp-sdk-docs-staging` with a placeholder page **only if they do not exist** (never overwrites); prints the permissions for 6.1 step 6.
2. **GitHub** (stdin only):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --env docs-production < "$PRODUCTION_TOKEN_FILE"
   gh secret set DOCS_STATE_TOKEN     --env docs-production < "$PRIVATE_DIR/webmcp-sdk-docs-state.token"
   gh secret set CLOUDFLARE_API_TOKEN --env docs-preview    < "$STAGING_TOKEN_FILE"
   gh secret set DOCS_STATE_TOKEN     --env docs-preview    < "$PRIVATE_DIR/webmcp-sdk-docs-preview-state.token"
   printf %s <id> | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-production
   printf %s <id> | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-preview
   gh variable set DOCS_WORKERS_SUBDOMAIN --body <sub>
   gh variable set DOCS_PREVIEW_MODE --body dynamic          # already set; staging needs the staging token instead
   # optional: gh variable set DOCS_PREVIEW_DEPENDABOT --body true   (default: Dependabot builds only)
   rm -rf "$PRIVATE_DIR" "$TEMP_TOKEN_FILE" "$PRODUCTION_TOKEN_FILE" "$STAGING_TOKEN_FILE"
   ```
3. **Enable**: `gh variable set DOCS_DEPLOY_ENABLED --body true`.
4. **Verify**: push to #6: in **docs-deploy**, `docs-deploy-plan` = deploy-preview, `docs-deploy-preview` green (`preflight` ok, smoke ✅), the PR comment and the `docs-preview` status with the URL, `curl -sI <url> | grep -i x-docs-revision`. If the deploy fails with 403 on the assets upload session, report it: Isaac applies the §3 fallback and decides on the reviewer. After #6 is merged: `docs-deploy-production` green and the production URL served.
5. **Required checks**: propose adding `docs` and `docs-build` to the `main` ruleset (§6.0 step 6).

Pause everything: `gh variable set DOCS_DEPLOY_ENABLED --body false`.

## 7. Operations

| Situation | Do |
| - | - |
| Bad content in production, now | Cloudflare dashboard → **Workers & Pages** → `webmcp-sdk-docs` → **Deployments** → previous version → **Rollback** (instant). Then fix forward on `main` (revert PR) |
| Roll back to a given commit | Actions → **docs-deploy** → *Run workflow* on `main`, `rollback_run_id` = id of a successful **docs** run of that commit on main. CLI: `gh workflow run docs-deploy.yml --ref main -f rollback_run_id=<id>` |
| Redeploy production from main | Actions → **docs** → *Run workflow* on `main` (rebuild); `docs-deploy` follows |
| Reset staging to `main` | re-run the latest docs run of any open PR, or wait for the next PR push (staging is never torn down) |
| Dynamic mode: a preview was not removed | weekly sweeper, or **docs-deploy** → *Run workflow* with `destroy_preview` = PR number (or `sweep_previews`) |
| A PR got no preview | read the `docs-deploy-plan` summary: it states the reason (fork, draft, Dependabot, superseded, build failed, no artifact, checks) |
| A deploy fails at *Gate* | a required check of that commit failed or is missing after 40 min: fix or re-run it, then re-run the deploy job |
| `preflight` fails | the message names the cause: user token instead of account token, wrong `DOCS_STATE_TOKEN` for the environment, store version behind Alchemy (re-run the bootstrap with a new temporary token), Worker missing or not in the token's scope, preview-side token reaching production while `docs-preview` is neither main-only nor reviewer-protected |
| Alchemy upgrade (Dependabot `docs-infra` PR) | review as untrusted; if the state API version changes, `preflight` fails until the stores are upgraded: run the bootstrap again (temporary token), then delete the token |
| Token leaked | Manage Account → API Tokens → **Roll** or **Delete**; update the env secret; review *Audit Logs*. Store token leaked: re-bootstrap the store with `--force` is not exposed; instead delete the store's token secret in Secrets Store and re-run the bootstrap (it recreates the missing secret) |
| Rotate yearly | Roll the CI tokens, hand over as in 6.1 step 5, `gh secret set … < file` |
| Inspect state | `DOCS_STATE=cloudflare DOCS_STATE_STORE=<store> DOCS_ALLOW_LOCAL_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=… pnpm exec alchemy state list` with a temporary token. Never `alchemy destroy` with these variables |

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
