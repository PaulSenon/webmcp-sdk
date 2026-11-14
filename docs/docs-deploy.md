# Docs site deployment

Maintainer runbook for the documentation site (`apps/docs`) on Cloudflare, in **one Cloudflare account** (Isaac's existing one). It covers the verified Cloudflare/Alchemy facts the design rests on, the architecture, the tokens and what each one can do, the residual risks per preview mode, the one-time setup split between Isaac and an agent, and operations.

- Infrastructure as code: [`infra/docs`](../infra/docs) (Alchemy v2, private workspace package `@senon/webmcp-sdk-docs-infra`).
- Pipeline: [`.github/workflows/docs.yml`](../.github/workflows/docs.yml).
- **Deploys are off** until the repository variable `DOCS_DEPLOY_ENABLED` is `true` (§6). Until then the workflow only builds and checks, without credentials.
- **The one decision for Isaac:** `DOCS_PREVIEW_MODE` = `staging` (recommended, default) or `dynamic` (§4).

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
   pull_request (same repo, into main; drafts build only)    push to main / workflow_dispatch
                        │                                                │
   ┌────────────────────▼────────────────────────────────────────────────▼──────────────────┐
   │ docs-build    (no secret, contents: read, cache-mode: none, runs PR code)              │
   │   pnpm install --frozen-lockfile ─ SITE_URL=<stage URL> pnpm docs:build ─ check-site   │
   │   alchemy dev (local workerd) + smoke test  ─ upload artifact docs-site-<stage>        │
   └───────────┬────────────────────────────────────────────────────────┬───────────────────┘
               │ artifact (static files = data)                         │
   ┌───────────▼──────────────────────────────┐   ┌─────────────────────▼────────────────────┐
   │ docs-deploy-preview   env docs-preview   │   │ docs-deploy-production env docs-production│
   │  current main's infra, infra deps only   │   │  newest main commit, or rollback_run_id  │
   │  PR open, not draft, head == built SHA?  │   │  GATE: all required checks of the SHA    │
   │  GATE: all required checks of the SHA    │   │  still head of main? preflight           │
   │  still head? preflight                   │   │  alchemy deploy --stage production, smoke│
   │  staging: --stage staging (serialised)   │   └──────────────────────────────────────────┘
   │  dynamic: --stage pr-<n>                 │
   └───────────┬──────────────────────────────┘
               │ url, status      dynamic only: closed / converted_to_draft ─► docs-teardown-preview
   ┌───────────▼───────────────────────────────────────────────┐   dynamic only, weekly ─► docs-sweep-previews
   │ docs-comment-preview: one marker comment per PR, upserted │
   └───────────────────────────────────────────────────────────┘

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

| Job | Trigger | Holds | Runs PR code? |
| - | - | - | - |
| `docs-build` | PR opened/synchronize/reopened/ready_for_review (**drafts included**), push to `main`, dispatch | read-only token | **yes** (site build) |
| `docs-deploy-preview` | same-repo, **non-draft** PR into `main`, not Dependabot, deploys enabled | env `docs-preview`: Cloudflare token + preview store token; `checks`/`pull-requests`/`actions: read` | no: current main's infra + the artifact |
| `docs-teardown-preview` | **dynamic mode only**: PR closed or converted to draft, or dispatch `destroy_preview` | env `docs-preview` | no |
| `docs-comment-preview` | after a preview deploy or teardown | `pull-requests: write` only | no |
| `docs-sweep-previews` | **dynamic mode only**: weekly cron or dispatch `sweep_previews` | env `docs-preview` | no |
| `docs-deploy-production` | push to `main`, dispatch on `main` (rebuild, or `rollback_run_id`) | env `docs-production`: Cloudflare token + production store token | no: current main's infra |

- **Drafts.** A draft builds and is checked but gets no preview; `ready_for_review` deploys. In dynamic mode `converted_to_draft` tears down like `closed`; in staging mode nothing is torn down (staging is shared and reused).
- **Deploy gate** ([`src/gate.ts`](../infra/docs/src/gate.ts), one list): a commit deploys only once every required check run of that exact SHA is green: `checks`, `browser`, `workflow-lint`, `docs` (ci.yml) and `docs-build` (docs.yml). Check-runs API, newest run per name, `github-actions` app only, polled for at most 40 min; anything but `success`, or the timeout, fails closed. The deploy jobs are not in the list.
- **Latest SHA only.** Previews re-read the PR before and after the gate (open, not a draft, head == built SHA); production checks it is still the head of `main` before and after the gate (rollback excepted).
- **Staging mode specifics.** One concurrency group `docs-staging` for all PRs: deploys are serialised and the newest pending one wins. Each deploy sets `X-Docs-Revision: pr-<n>@<sha7>` on staging responses, and the PR comment says "Staging now serves this PR at commit …". Closing a PR does not touch staging.
- **PR comment.** One per PR, found by the hidden marker `<!-- webmcp-sdk-docs-preview -->` and author `github-actions[bot]`, upserted via REST; teardowns update it but never create it; content is validated before entering Markdown.
- **`preflight`** ([`scripts/cli.ts`](../infra/docs/scripts/cli.ts), [`src/isolation.ts`](../infra/docs/src/isolation.ts)), before any alchemy call: the Cloudflare token is an active **account** token of this account; `DOCS_STATE_TOKEN` is the token of this stage's store (others get 401) and the store speaks this Alchemy's state API version; the production or staging Worker exists and the token can see it; a preview-side token that **can see the production Worker** (dynamic mode, or a staging token broader than its Worker) is refused unless the `docs-preview` environment has a required reviewer.
- **No plan without credentials**: Alchemy's plan reads the live account; PRs instead run the build in local workerd with the smoke test. **Smoke test** after every deploy: served `index.html`/`404.html` bytes = artifact, security headers, `noindex` and `X-Docs-Revision` off production, `/assets/*` immutable, clean URLs.
- **Hygiene**: `permissions: {}`, least privilege per job, SHA-pinned actions (GitHub-owned + `pnpm/action-setup`), Alchemy via `pnpm exec`, `persist-credentials: false`, inputs only via `env:`, `cache-mode: none` everywhere, zizmor pedantic (also in CI) and actionlint clean, Alchemy telemetry off.

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

| | `staging` (recommended, default) | `dynamic` |
| - | - | - |
| What PRs get | the shared Worker `webmcp-sdk-docs-staging`; last PR deployed wins | one Worker per PR, removed on close/draft, weekly sweep |
| Preview token | Editor on `webmcp-sdk-docs-staging` only | Admin on **all** Workers of the account |
| Approval | none (unless the token turns out broader, see fallback) | **required reviewer on `docs-preview`**: every preview deploy, teardown and sweep waits for Isaac (`preflight` refuses to run otherwise) |
| Production Worker reachable by the preview token? | **no** | **yes**: it can overwrite or delete `webmcp-sdk-docs`, the state-store Workers and **every other Worker of Isaac's account** |
| Production state reachable? | no (separate store and bearer token) | no (same), but the token could delete the production state-store Worker |

Residual risks:

| Holder of… | Can do | Cannot do |
| - | - | - |
| production token | deploy any content to `webmcp-sdk-docs`, roll it back, change its settings | create/delete Workers, touch staging, other Workers, Secrets Store, zones |
| production store token (`DOCS_STATE_TOKEN`, docs-production) | read/write/delete production *state* records (Alchemy may then mis-plan; no Cloudflare resource changes by itself) | call the Cloudflare API |
| staging token | deploy any content to staging | touch production or any other Worker; create/delete |
| preview store token | read/write staging/preview state | production state |
| dynamic token | **anything on every Worker of the account**: overwrite or delete production and Isaac's other projects | Secrets Store, zones |
| a writer with a same-repo PR (edits `docs.yml` in the PR) | use the `docs-preview` secrets: in staging mode, deface staging; in dynamic mode, only after Isaac approves the run | use `docs-production` (branch policy `main`, no admin bypass) |
| a fork PR, Dependabot | nothing (no secrets, no preview jobs) | |
| temporary bootstrap token, while it exists | everything on Workers; create/edit/delete/bind **any secret of the account's Secrets Store** | (expires after 1 day; delete it right after the bootstrap) |

Why approval mitigates dynamic mode: GitHub releases environment secrets only after the required reviewer approves that job, so neither a PR's modified workflow nor a compromised dependency of the infra can use the account-wide token without Isaac looking at the run first. It turns an automatic capability into a supervised one; it does not reduce what the token can do once approved.

## 5. Threat model delta (vs [`02-threat-model.md`](release-research/02-threat-model.md))

| # | Threat | Controls | Residual |
| - | - | - | - |
| **T13'** | Malicious docs deploy / defacement | production token only in env `docs-production` (branch policy `main`, no admin bypass) ⇒ needs a merged PR; scoped to `webmcp-sdk-docs` only; staging token scoped to staging only; dynamic mode gated by a required reviewer; no fork deploys; no `pull_request_target`/`workflow_run`; Dependabot excluded; gate on every required check of the SHA | a merged malicious change deploys (rollback §7); a writer can deface staging |
| **T17'** | Docs build compromise | build job has no secret, no write token, no cache; deploy jobs never install site deps (current main's infra only); artifact validated as data (no symlinks, control characters, credential files; Cloudflare limits); headers/redirects from infra | a compromised build serves malicious static content; CSP limits it to same-origin script |
| T20 | Cloudflare token theft | per-environment, per-Worker, account-owned, expiring tokens; never passed to steps other than `preflight`/`alchemy`; no caches | see §4 per token |
| T21 | State tampering / leak | state over HTTPS with per-store bearer tokens; separate production and preview stores; CI cannot create/upgrade stores; `preflight` checks token-store match and API version | a stolen store token can corrupt that store's records (detected as plan anomalies; recover by re-adopting) |
| T22 | Preview abuse | `noindex`, `X-Docs-Revision`, staging/previews only from writers' PRs | previews are public; same registrable domain (`<sub>.workers.dev`) as production, but the site sets no cookies |
| T23 | Alchemy supply chain | exact pins, lockfile, release-age and cooldown policy, `docs-infra` Dependabot group, telemetry off | bounded by the token scopes above |
| T24 | Stale or unchecked deploy | gate, PR-head and head-of-main checks before and after the gate, serialised staging, smoke byte comparison | anyone with write access can dispatch a rollback |

## 6. One-time setup

Isaac does only what needs his login, his 2FA or his decision. An agent (or Isaac with the same commands) does the rest from an up-to-date `main`, with `gh` logged in as a repository admin. No token ever appears in chat, argv, logs or shell history.

### 6.0 Merge order and staging

1. Merge **#7** (this PR): infra inert, CI checks it against the fixture site.
2. Rebase **#6** (the site) onto `main`, regenerating the lockfile (`pnpm install`). Keep both #6's `docs` job and `persona: pedantic` in `ci.yml`.
3. Do 6.1 and 6.2 below. Then push to #6 (or re-run its docs run): **#6 deploys to staging** (`https://webmcp-sdk-docs-staging.<sub>.workers.dev/`) once all its required checks are green; Isaac reviews the content there. Every push redeploys; `X-Docs-Revision` shows the commit.
4. Merging **#6** deploys production from the merge commit, again only once all its required checks are green. Staging keeps the last PR deployed.

This works with the design: deploy jobs use **main's** infra (present after step 1), `docs-build` builds #6's `apps/docs`, and until #6 is merged production deploy jobs are skipped (`has_site` false).

### 6.1 Isaac only

1. **Log in, 2FA.** <https://dash.cloudflare.com/login> → *My Profile* → **Authentication** → **Add** (*Mobile App Authentication*, then *Security Key Authentication*); keep the backup codes ([2FA](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/)).
2. **Decide the preview mode**: `staging` (recommended) or `dynamic` (§4).
3. **Copy the Account ID**: **Search** (Cmd/Ctrl-K) → *Copy account ID*, or **Workers & Pages** → *Account Details* → **Account ID** ([find IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)). Note the account's **workers.dev subdomain** (`<sub>` in any existing `https://<worker>.<sub>.workers.dev` URL; shown in **Workers & Pages**).
4. **Create the temporary bootstrap token**: **Manage Account → API Tokens → Create Token → Create Custom Token**; name `docs-bootstrap-temp`; permissions *Workers: Admin (All Workers)* and *Account Secrets Store: Edit* (§3); **Token expiration**: tomorrow; **Continue to summary → Create Token**.
5. **Hand it over** through the agent's local secure file card (T3 `request_secret`, `delivery: "file"`), never in chat. The agent runs 6.2 step 1.
6. **Create the two CI tokens** (the bootstrap printed the exact names), same path: `github-docs-production` = *Workers → Specified Workers → `webmcp-sdk-docs` → Editor*; `github-docs-staging` = *Workers → Specified Workers → `webmcp-sdk-docs-staging` → Editor* (in dynamic mode instead: `github-docs-preview-dynamic` = *Workers → All Workers → Admin*). Nothing else. Expiration 1 year. Hand both over through the file card.
7. **Delete the temporary token**: Manage Account → API Tokens → `docs-bootstrap-temp` → **Delete**.
8. Dynamic mode only: GitHub → Settings → Environments → `docs-preview` → **Required reviewers**: add yourself, **Save protection rules**.

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
   gh variable set DOCS_PREVIEW_MODE --body staging          # or dynamic (6.1 step 8 first)
   rm -rf "$PRIVATE_DIR" "$TEMP_TOKEN_FILE" "$PRODUCTION_TOKEN_FILE" "$STAGING_TOKEN_FILE"
   ```
3. **Enable**: `gh variable set DOCS_DEPLOY_ENABLED --body true`.
4. **Verify**: push to #6 (or re-run its docs run): `docs-deploy-preview` green, `preflight` ok, smoke ✅, the PR comment with the staging URL, `curl -sI <staging url> | grep -i x-docs-revision`. If the deploy fails with 403 on the assets upload session, report it: Isaac applies the §3 fallback and decides on the reviewer. After #6 is merged: `docs-deploy-production` green and the production URL served.
5. **Required checks**: propose (rulesets are not changed by this PR) adding `docs` and `docs-build` to the `main` ruleset, never the deploy jobs.

Pause everything: `gh variable set DOCS_DEPLOY_ENABLED --body false`.

## 7. Operations

| Situation | Do |
| - | - |
| Bad content in production, now | Cloudflare dashboard → **Workers & Pages** → `webmcp-sdk-docs` → **Deployments** → previous version → **Rollback** (instant). Then fix forward on `main` (revert PR) |
| Roll back to a given commit | Actions → **docs** → *Run workflow* on `main`, `rollback_run_id` = id of a successful docs run of that commit. CLI: `gh workflow run docs.yml --ref main -f rollback_run_id=<id>` |
| Reset staging to `main` | re-run the latest docs run of any open PR, or wait for the next PR push (staging is never torn down) |
| Dynamic mode: a preview was not removed | weekly sweeper, or *Run workflow* with `destroy_preview` = PR number (or `sweep_previews`) |
| A deploy fails at *Gate* | a required check of that commit failed or is missing after 40 min: fix or re-run it, then re-run the deploy job |
| `preflight` fails | the message names the cause: user token instead of account token, wrong `DOCS_STATE_TOKEN` for the environment, store version behind Alchemy (re-run the bootstrap with a new temporary token), Worker missing or not in the token's scope, staging token too broad without a reviewer |
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
- GitHub: [pull_request activity types; no secrets for forks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [check runs API](https://docs.github.com/en/rest/checks/runs), [environments API](https://docs.github.com/en/rest/deployments/environments), [environment branch policies on `refs/pull/<n>/merge`](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/).
- Verified locally without an account: `alchemy dev` serves an assets-only Worker in workerd with the `_headers` rules; `alchemy plan` needs credentials; `DOCS_STATE=http` reaches the store over HTTPS (transport error against a non-existent store) and the stage/store guard refuses a mismatch; `state bootstrap` runs non-interactively up to the account-access check.
