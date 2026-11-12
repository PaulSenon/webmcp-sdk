# Docs site deployment

Maintainer runbook for the documentation site (`apps/docs`) on Cloudflare. It covers the architecture, the security design and its threat-model delta, the cost, the **one-time setup**, and day-to-day operations (rollback, teardown, custom domain).

- Infrastructure as code: [`infra/docs`](../infra/docs) (Alchemy v2, private workspace package `@senon/webmcp-sdk-docs-infra`).
- Pipeline: [`.github/workflows/docs.yml`](../.github/workflows/docs.yml).
- **Deploys are off** until the repository variable `DOCS_DEPLOY_ENABLED` is `true` (§4.5). Until then the workflow only builds and checks, without credentials.

## 1. Architecture

```
             pull_request (same repo, into main)             push to main / workflow_dispatch
                        │                                                │
   ┌────────────────────▼────────────────────────────────────────────────▼──────────────────┐
   │ docs-build    (no secret, contents: read, cache-mode: none, runs PR code)              │
   │   pnpm install --frozen-lockfile ─ SITE_URL=<stage URL> pnpm docs:build ─ check-site   │
   │   alchemy dev (local workerd) + smoke test  ─ upload artifact docs-site-<stage>        │
   └───────────┬────────────────────────────────────────────────────────┬───────────────────┘
               │ artifact (static files = data)                         │
   ┌───────────▼──────────────────────────────┐   ┌─────────────────────▼────────────────────┐
   │ docs-deploy-preview   env docs-preview   │   │ docs-deploy-production env docs-production│
   │  checkout current main, infra deps only, │   │  newest main commit, or rollback_run_id  │
   │  PR still open? check artifact, deploy   │   │  checkout main, infra deps only,         │
   │  --stage pr-<n>, smoke test              │   │  alchemy deploy --stage production, smoke│
   └───────────┬──────────────────────────────┘   └─────────────────────┬────────────────────┘
               │ url                                                    │
   ┌───────────▼──────────────┐  PR closed ─► docs-teardown-preview ─► alchemy destroy pr-<n>
   │ docs-comment-preview     │  (pull-requests: write, no Cloudflare secret)
   └──────────────────────────┘

 Cloudflare account "preview" (recommended)        Cloudflare account "production"
   Worker webmcp-sdk-docs-pr-<n>  (assets only)      Worker webmcp-sdk-docs       (assets only)
   Worker webmcp-sdk-docs-state   (Alchemy state)    Worker webmcp-sdk-docs-state (Alchemy state)
   https://webmcp-sdk-docs-pr-<n>.<sub>.workers.dev  https://webmcp-sdk-docs.<sub>.workers.dev
```

**Hosting: Workers static assets, not Pages.** Cloudflare's own guidance is "Start new projects with Workers" ([Pages docs](https://developers.cloudflare.com/pages/)). Static-asset requests are free and unlimited ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). The site Worker is **assets-only**: no script is uploaded, so no request ever invokes code, counts against the 100,000 requests/day Free limit, or can get a 429 for exceeding it (that risk only exists with `run_worker_first`).

**Routing** ([SSG and 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)): `html_handling: drop-trailing-slash` (`/guide` serves `guide.html` or `guide/index.html`, `/guide/` redirects to `/guide`: the site's links, canonical URLs and sitemap have no trailing slash), `not_found_handling: 404-page` (unknown paths get `404.html` with status 404).

**Headers** are rendered by [`infra/docs/src/headers.ts`](../infra/docs/src/headers.ts) as a `_headers` file and passed in the Worker's asset config, which overrides any `_headers`/`_redirects` in the build output ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)). Headers belong to the reviewed infra package, not to site content:

| Header | Value | Why |
| - | - | - |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Same-origin only. `'unsafe-inline'` for scripts is forced by the prerendered React Router pages (inline hydration context and module bootstrap, plus the theme script; no per-request nonce on a static site). Still blocks third-party scripts, plugins, framing, `<base>` hijack and fetch-based exfiltration. Hash-based policy: §6 |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | `.dev` is HSTS-preloaded already; matters for a custom domain. No `preload` (domain owner's decision) |
| `X-Content-Type-Options` / `X-Frame-Options` | `nosniff` / `DENY` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, … all `()` | a docs site needs none |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | process isolation; no hotlinking by other sites |
| `X-Robots-Tag` | `noindex, nofollow` | previews and local stages only |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | content-hashed files (Vite's output dir in `apps/docs`). Everything else keeps Cloudflare's default `public, max-age=0, must-revalidate` + ETag, so a deploy is visible immediately |

Changing the CSP (for example to embed a third-party demo) is an infra PR, reviewed like any security change.

**Why the infra lives in `infra/docs` (not `apps/docs/alchemy.run.ts`):** the deploy jobs check out *only* the infra package and install *only* its dependencies (`pnpm --filter @senon/webmcp-sdk-docs-infra install`, 126 packages, none of the site's toolchain). Keeping it out of the site package makes that separation physical: no site dependency, MDX plugin or React Router/Vite code is installed in a job that holds a Cloudflare token. It also keeps the site thread and the infra changes in separate files.

**Alchemy v2** (`alchemy@2.0.0-beta.85`, `@alchemy.run/cloudflare@2.0.0-beta.85`, `effect@4.1.2`, all exact pins): an Effect-based TypeScript IaC framework ([alchemy.run](https://alchemy.run/getting-started)). The stack is [`infra/docs/alchemy.run.ts`](../infra/docs/alchemy.run.ts): one `Cloudflare.Worker` with `assets`, `workersDev: { enabled: true, previewsEnabled: false }` (no per-version preview URLs that would keep every old build public), observability off (nothing executes). Alchemy v2 is still a **beta** on npm's `latest` tag: pinned exactly, grouped in Dependabot (`docs-infra`), with an escape hatch (§6).

### Stages

| Stage | Worker | State | Who |
| - | - | - | - |
| `production` | `webmcp-sdk-docs` | Cloudflare state store | CI, `main` only, env `docs-production` |
| `pr-<n>` | `webmcp-sdk-docs-pr-<n>` | Cloudflare state store | CI, same-repo PRs into `main`, env `docs-preview`; destroyed on close |
| anything else (`live_$USER`, `dev_$USER`, …) | `webmcp-sdk-docs-<stage>` | local `.alchemy/` (gitignored) | developers |

The stack refuses mismatches: remote stages require `DOCS_STATE=cloudflare` (set by the workflow only), local stages refuse it. Outside GitHub Actions, `DOCS_STATE=cloudflare` is refused at import unless `DOCS_ALLOW_LOCAL_REMOTE=1` is also set; this matters because `alchemy destroy` does not run the stack program, so the stage checks alone would not stop `alchemy destroy --stage production` from a laptop. A local `alchemy deploy` therefore never reads or writes remote state by accident. `prod`, `pr-x`, `pr-01` are reserved and rejected.

Local development, no Cloudflare account needed:

```sh
pnpm docs:build                                   # once the site exists (apps/docs/out)
cd infra/docs && pnpm dev                         # alchemy dev: serves the build in local workerd with production headers
DOCS_SITE_DIR=../../apps/docs/out pnpm check:local   # same check CI runs: local workerd + smoke test
```

### State store

`Cloudflare.state({ workerName: "webmcp-sdk-docs-state", accountId })` ([State Store](https://alchemy.run/state-store)): a Worker + SQLite Durable Object in the deploy account, state encrypted at rest with a key kept in the account's Secrets Store, bearer token also in Secrets Store. Durable (Cloudflare storage), free (SQLite-backed Durable Objects are on the Free plan: 5 GB, 100,000 requests/day; [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)), not in the repository, locked per stage while a deploy runs. The dedicated `workerName` means it never shares state with any other Alchemy project, and `accountId` is pinned. In CI, Alchemy reads the store's token by uploading an ephemeral *edge preview* of the state-store Worker that binds the secret: that is why the token needs Secrets Store **Edit** ([Alchemy CI](https://alchemy.run/environments/ci), [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/)). Caveat verified in the Alchemy source: `--yes` (required in CI) also authorizes Alchemy to *create* a missing store and to *replace* a store of another version (`updateStateStore`). So the workflow (a) runs `cli.ts check-store` before every `alchemy` call and fails if the bootstrapped store is absent, and (b) always runs the infra of the **current** `main`, never an older commit whose Alchemy would downgrade the store. You bootstrap each store once (§4.2); an Alchemy upgrade merged to main upgrades it on the next deploy.

Alternatives considered: AWS/GCP stores (need a second cloud), Postgres (needs a database), local file state committed to git (rejected: state in the repo, races), R2-backed (needs a payment method on file to enable R2).

### Pipeline

| Job | Trigger | Holds | Runs PR code? |
| - | - | - | - |
| `docs-build` | every PR event except close, push to `main`, dispatch | read-only token | **yes** (site build) |
| `docs-deploy-preview` | PR from this repo into `main`, not Dependabot, still open, deploys enabled | env `docs-preview` Cloudflare token | no: current main's infra + the artifact; stage and URL recomputed from the event and repository variables, compared with the build's |
| `docs-comment-preview` | after preview deploy | `pull-requests: write` | no |
| `docs-teardown-preview` | PR closed (same-repo, any base branch), or dispatch with `destroy_preview` | env `docs-preview` token | no |
| `docs-deploy-production` | push to `main`, dispatch on `main` (rebuild, or `rollback_run_id`), deploys enabled | env `docs-production` token | no: current main's infra |

- **No plan without credentials.** Alchemy's `plan` reads the live account (it fails with an auth error before printing anything), so a PR cannot show a cloud diff without a token. Instead `docs-build` serves the build with `alchemy dev` in local workerd (the same asset router, with the PR's headers and 404 config) and runs the post-deploy smoke test against it. The cloud diff is printed by `alchemy deploy` in the deploy job logs.
- **Concurrency.** Build: per PR, cancels superseded PR builds (never main). Deploys: `docs-preview-<n>` and `docs-production`, `cancel-in-progress: false`, so an in-flight deploy is never interrupted and the newest pending run wins. Two pushes whose builds finish out of order cannot deploy an older commit: production deploys only if the run's commit is still the head of `main` (re-running an old run is therefore a no-op; roll back with `rollback_run_id`). A preview deploy whose PR was closed meanwhile is skipped, so it cannot resurrect a preview after teardown.
- **Smoke test** ([`src/smoke.ts`](../infra/docs/src/smoke.ts)), after every deploy: waits (up to 3 min) until `/` serves the uploaded `index.html` byte for byte (proves the new version is live), checks every security header, `noindex` iff preview, an unknown path returns 404 with the uploaded `404.html`, `_headers`/`_redirects` are not served, an `/assets/` file referenced by `index.html` is `immutable`, and a page directory is served at `/<dir>` with `/<dir>/` redirecting to it. Headers on the 404 response are a warning only: Cloudflare does not document whether `_headers` applies to `404-page` responses (local workerd does apply them).
- **Hygiene** (same as `ci.yml`/`release.yml`): `permissions: {}` at the top, least privilege per job, actions pinned by SHA (only GitHub-owned + `pnpm/action-setup`), Alchemy called through `pnpm exec` (no third-party action), `persist-credentials: false`, every expression in `run:` passed through `env:`, `cache-mode: none` and `package-manager-cache: false` on every job, zizmor (pedantic) and actionlint clean, Alchemy telemetry off (`DO_NOT_TRACK=1`; it is on by default and sends anonymised usage to `otel.alchemy.run`).
- **Required checks.** `pnpm test:infra` (typecheck + 24 unit tests) runs inside the existing required `checks` job. The new jobs are not required. Recommendation once `apps/docs` exists: make `docs-build` required (it has no path filter, so it always reports).

## 2. Threat model delta (vs [`02-threat-model.md`](release-research/02-threat-model.md))

The Cloudflare design replaces GitHub Pages (D3) and changes T13/T17; T3/T7 are unchanged and apply to the new jobs.

| # | Threat | Controls | Residual |
| - | - | - | - |
| **T13'** | **Malicious docs deploy / defacement** | production token only in env `docs-production` (branch policy `main`, no admin bypass), so it needs a merged PR (ruleset); preview token in env `docs-preview` (policies `main`, `refs/pull/*/merge`); fork PRs get no secrets and no preview job; no `pull_request_target`/`workflow_run`; Dependabot PRs excluded; **separate Cloudflare account for previews** so the preview token cannot reach production; production token scoped to two Workers (Editor, cannot create or delete) | a writer can edit `docs.yml` in a same-repo PR and use the *preview* token: contained to the preview account **only with two accounts** (in single-account mode this is a production compromise for any writer). The build job's outputs are untrusted: deploy jobs recompute stage/URL and compare. A merged malicious change deploys (rollback §5) |
| **T17'** | **Docs build compromise** (site deps, MDX, plugins run in the build) | build job has no secret, no write token, no cache; deploy jobs never install site deps (infra-only filtered install from the **base** commit); artifact validated as data: regular files only, no symlinks (Alchemy uploads a symlink's target), no control characters in names (log-command forgery), no `.env*`/`.npmrc`/`.git`/`*.pem`, Cloudflare limits; headers/redirects from infra, overriding the build's | a compromised build can still serve malicious static content (that is its job); CSP limits it to same-origin script, no exfiltration via `connect-src`. Detection: review of the deployed diff is manual |
| T20 | **Cloudflare token theft** | per-environment tokens; account-owned `cfat_` tokens (scannable by GitHub secret scanning); production: Workers Editor on 2 Workers + Secrets Store Edit, in a dedicated account (nothing else to reach); expiry set (1 year); masked by GitHub; never passed to steps other than `alchemy deploy/destroy`; no caches in those jobs | stolen production token can overwrite the site and read/write its state; revoke in Cloudflare (§5). I found no Cloudflare-documented exchange of a GitHub OIDC token for API credentials (2026-11-12), so the token is static; switch to it if Cloudflare ships one |
| T21 | **State store tampering / leak** | state encrypted at rest, store token in Secrets Store, store reachable only with the deploy token; separate stores per account; local stages cannot use it | anyone with the deploy token can read state (Worker names, hashes; no secret values: the site has none) |
| T22 | **Preview abuse** (phishing on our workers.dev, cookie tossing) | previews only for writers' PRs; `noindex`; separate account ⇒ different registrable domain (`workers.dev` is on the Public Suffix List, so each account subdomain is its own site); the site sets no cookies; previews destroyed on close | previews are public while the PR is open (Access gating: §6) |
| T23 | **Alchemy / Effect supply chain** (beta framework with the token) | exact pins, lockfile, pnpm `minimumReleaseAge` 3 d, Dependabot cooldown 7 d, `docs-infra` group reviewed as a unit; the only install script in the infra tree (`workerd`) is disabled; telemetry off | a malicious Alchemy release that passes review runs with the deploy token. Bounded by the token scope above |
| T24 | **Out-of-order or stale deploy** | `cancel-in-progress: false`, head-of-main check, PR-open check, smoke test compares served bytes with the artifact; rollback deploys a validated old artifact (successful `docs` push run on `main`, same repo) with the current infra | anyone with write access can dispatch a rollback (no reviewers on `docs-production`); add a required reviewer there if a 2nd maintainer joins |

T3 (cache poisoning): no cache anywhere in `docs.yml`, including the build whose artifact production serves. T7 (actions): same pins and allowlist; Alchemy is a pinned npm dependency, not an action.

## 3. Cost: 0 €

| Item | Free allowance | This site |
| - | - | - |
| Workers static-asset requests | free, unlimited | all site traffic |
| Workers per account | 100 (Free) | 1 production; previews: 1 per open PR (preview account) |
| Assets per version | 20,000 files, 25 MiB per file (Free) ([limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets)) | checked before upload |
| State store (Worker + SQLite DO) | 100,000 req/day, 5 GB SQLite | a few dozen requests per deploy, KBs |
| Secrets Store | open beta, 100 secrets per account ([changelog](https://developers.cloudflare.com/changelog/post/2025-05-19-paygo-updates/)) | 2 per account |
| Additional Free accounts | up to 5 per user ([create account](https://developers.cloudflare.com/fundamentals/account/create-account/)) | 1 (preview) |
| GitHub Actions minutes and artifacts | free for public repositories | ~3–5 min per run |
| Custom domain (optional, off) | DNS zone on the Cloudflare Free plan | domain registration only, if you want one |

No payment method is needed. Watch-outs: Secrets Store is a beta without published pricing (if it ever becomes paid, the state store can move to another backend), and Free plan limits fail closed (errors, not bills).

## 4. One-time setup (Isaac)

About 30 minutes. Do it after this PR **and** the site PR are merged. Nothing here goes in the repository.

### 4.1 Cloudflare accounts

1. Log in at <https://dash.cloudflare.com> (or sign up; the user must be 7 days old to create extra accounts). Turn on 2FA with a security key: *My Profile → Authentication*.
2. **Accounts → Create Account** twice: `webmcp-sdk-docs` (production) and `webmcp-sdk-docs-preview`. Free plan, no payment method. Two accounts are what makes the security claims hold (T13', T22). *(Single-account mode works technically: same values in both environments; but then any writer's PR can use the preview token, an Admin token, against production. Only acceptable while you are the sole writer, and then add a required reviewer on `docs-preview`.)*
3. In each account: **Workers & Pages** once, accept the `workers.dev` subdomain it proposes, and note it (`<sub>` in `https://<name>.<sub>.workers.dev`). Note each **Account ID** (*Account home → ⋯ → Copy account ID*).

### 4.2 Bootstrap the state stores (your machine, your own login)

CI cannot create them. In a clean checkout of `main`:

```sh
pnpm install --frozen-lockfile
cd infra/docs
export DO_NOT_TRACK=1
pnpm exec alchemy profile create docs-admin
pnpm exec alchemy profile edit --profile docs-admin     # add Cloudflare: OAuth in the browser is fine here
export DOCS_STATE=cloudflare DOCS_ALLOW_LOCAL_REMOTE=1     # deliberate local use of remote state
CLOUDFLARE_ACCOUNT_ID=<production account id> pnpm exec alchemy state bootstrap --profile docs-admin
CLOUDFLARE_ACCOUNT_ID=<preview account id>    pnpm exec alchemy state bootstrap --profile docs-admin
unset DOCS_STATE DOCS_ALLOW_LOCAL_REMOTE
```

If the OAuth login lacks a Secrets Store scope, reconfigure the profile with an API token instead (`alchemy profile edit --profile docs-admin --reconfigure Cloudflare`). Each run creates, in that account only, the Worker `webmcp-sdk-docs-state`, a Secrets Store and its two secrets. Check in the dashboard: *Workers & Pages* lists `webmcp-sdk-docs-state`; *Secrets Store* lists `AlchemyStateStoreToken_webmcp_sdk_docs_state` and the encryption key.

### 4.3 API tokens (account-owned)

In each account: **Manage account → Account API tokens → Create Token → Custom token**. Set an **expiration** (1 year; put a reminder in your calendar). No IP filter (GitHub-hosted runners have no stable IPs).

**Preview account**, name `github-docs-preview`:

| Permission | Scope | Level |
| - | - | - |
| Workers | All Workers in the account (product) | **Admin** (creates and deletes `webmcp-sdk-docs-pr-<n>`) |
| Secrets Store | Account | **Edit** |

**Production account**, name `github-docs-production`. The production Worker does not exist yet and per-Worker permissions only apply to existing Workers, so create it in two steps:

1. Now: Workers **Admin** (product) + Secrets Store **Edit**.
2. After the first successful production deploy (§4.5), *Edit token* and replace the Workers permission with:

| Permission | Scope | Level |
| - | - | - |
| Workers | All Workers (product) | **Metadata Read-Only** (Alchemy reads the account's workers.dev subdomain) |
| Workers | Individual Workers: `webmcp-sdk-docs`, `webmcp-sdk-docs-state` | **Editor** (deploy; cannot create or delete) |
| Secrets Store | Account | **Edit** |

Then *Actions → docs → Run workflow* on `main` (empty input) to confirm a deploy still works. If it fails with a 403 (per-Worker scoping for the state store's edge-preview has not been verified live), use Workers **Editor** at the product scope instead: still cannot create or delete Workers, and the account contains nothing else. If the dashboard does not offer Secrets Store for account-owned tokens, create a user-owned token (*My Profile → API Tokens*) with the same permissions restricted to that one account.

The tokens never go anywhere but the GitHub environment secrets below. Do not paste them in a terminal history; use the GitHub UI or `gh secret set` reading from stdin.

### 4.4 GitHub

The environments `docs-production` (branch policy `main`) and `docs-preview` (policies `main` and `refs/pull/*/merge`) already exist, without reviewers and without admin bypass. Add:

| Where | Name | Value |
| - | - | - |
| env `docs-production` → secrets | `CLOUDFLARE_API_TOKEN` | production token |
| env `docs-production` → secrets | `CLOUDFLARE_ACCOUNT_ID` | production account ID |
| env `docs-preview` → secrets | `CLOUDFLARE_API_TOKEN` | preview token |
| env `docs-preview` → secrets | `CLOUDFLARE_ACCOUNT_ID` | preview account ID |
| repository → variables | `DOCS_WORKERS_SUBDOMAIN` | production account's workers.dev subdomain (`<sub>` only) |
| repository → variables | `DOCS_PREVIEW_WORKERS_SUBDOMAIN` | preview account's subdomain (omit in single-account mode) |
| repository → variables | `DOCS_DEPLOY_ENABLED` | `true`, **last** (§4.5) |

```sh
gh secret set CLOUDFLARE_API_TOKEN  --env docs-production    # paste, Enter, Ctrl-D
gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-production
gh secret set CLOUDFLARE_API_TOKEN  --env docs-preview
gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-preview
gh variable set DOCS_WORKERS_SUBDOMAIN --body <production sub>
gh variable set DOCS_PREVIEW_WORKERS_SUBDOMAIN --body <preview sub>
```

### 4.5 Enable

```sh
gh variable set DOCS_DEPLOY_ENABLED --body true
gh workflow run docs.yml --ref main          # first production deploy
```

Check the run: `docs-deploy-production` green, smoke test summary all ✅, <https://webmcp-sdk-docs.<sub>.workers.dev/> serves the site. Then narrow the production token (§4.3 step 2) and run the workflow again. Open a test PR: the bot comments the preview URL; close it: `docs-teardown-preview` removes the Worker.

To pause all deploys at any time: `gh variable set DOCS_DEPLOY_ENABLED --body false` (jobs are skipped, CI stays green).

## 5. Operations

| Situation | Do |
| - | - |
| Bad content in production, now | **Cloudflare dashboard → production account → Workers & Pages → `webmcp-sdk-docs` → Deployments → previous version → Rollback** (instant, no CI). Then fix forward on `main` (revert PR); the next deploy differs from what state recorded, so it uploads |
| Roll back to a given commit | Actions → **docs** → *Run workflow* on `main`, `rollback_run_id` = the id of a successful docs run of that commit (in its URL `/actions/runs/<id>`). The job checks it is a push run on `main` of this repo, then deploys its `docs-site-production` artifact (kept 90 days) with the current infra. CLI: `gh workflow run docs.yml --ref main -f rollback_run_id=<id>`. Re-running an old run does nothing (it is no longer the head of main) |
| A preview was not removed (deploys were off, job failed) | Actions → docs → *Run workflow* on `main` with `destroy_preview` = PR number |
| Smoke test failed after deploy | the deploy is live: read the summary; roll back as above if users are affected |
| Token leaked or suspicious | Cloudflare → *Account API tokens* → **Roll** or delete; update the env secret; review *Audit logs*. Production token compromise: also check *Deployments* for unknown versions |
| Rotate yearly | *Roll* the token, `gh secret set CLOUDFLARE_API_TOKEN --env …` |
| Alchemy upgrade (Dependabot `docs-infra` PR) | review the changelog and lockfile diff as untrusted (T16); after merge, the first deploy may upgrade the state-store Worker in place (Alchemy does this when its version changes) |
| `alchemy deploy` says the stage is locked | another deploy of the same stage is running, or a run was killed: wait, then re-run |
| Inspect state | locally: `DOCS_STATE=cloudflare DOCS_ALLOW_LOCAL_REMOTE=1 CLOUDFLARE_ACCOUNT_ID=<id> pnpm exec alchemy state list --profile docs-admin`. Never `alchemy destroy` with these variables: destroy skips the stack's stage checks |

### Custom domain later (D12, off by default)

1. Add the domain's zone to the production account (*Add a site*, Free plan) and switch the registrar's nameservers to Cloudflare.
2. In `alchemy.run.ts`, for `production` only: `domain: "docs.<domain>"` on the Worker (Alchemy attaches a Workers Custom Domain and its DNS record). Keep `workersDev` enabled during the switch, or set it to `false` afterwards.
3. Token: add **Zone → Workers Routes → Edit** for that zone ([custom domains need it](https://developers.cloudflare.com/workers/authorization/workers/#routes-and-custom-domains); per-Worker roles do not cover custom domains yet). Add it before merging step 2.
4. Repository variable: replace the URL logic with the custom domain (`SITE_URL`, smoke URL): a small change in `docs.yml` and `src/stage.ts`.
5. Consider `preload` in HSTS only once you are sure every subdomain is HTTPS forever.

## 6. Deferred (proposals, not implemented)

1. **Hash-based CSP.** At deploy time, compute the SHA-256 of every inline `<script>` per HTML file and inject a `<meta http-equiv="Content-Security-Policy">` with `script-src 'self' 'sha256-…'`. Browsers enforce both policies, so the header keeps `frame-ancestors` and the meta removes `'unsafe-inline'`. Needs the real site output to test; follows the site PR.
2. **Orphan preview sweeper** (planned next). Weekly scheduled job: list `pr-*` stages in the preview state store and destroy those whose PR is closed. Remaining orphan cases today: a PR closed while deploys were disabled, or a PR GitHub runs no workflow for (merge conflicts: no merge ref). Until then: the `destroy_preview` dispatch input.
3. **Cloudflare Access on previews** (Zero Trust Free, 50 users): previews visible only to you. Adds an Access app and a token permission.
4. **`docs-build` as a required check** once `apps/docs` exists.
5. **Drift detection**: scheduled `alchemy drift` against production (read-only token) and an uptime check of the production URL.
6. **Escape hatch if Alchemy v2 stalls**: the same site deploys with Wrangler (`assets.directory`, `not_found_handling`, `html_handling`, `_headers` from `cli.ts headers`), with the same tokens and workflow structure.
7. **Versioned docs** (D8: stable at `/`, `main` at `/next/`) once there is a release: build both into one directory before upload; the infra does not change.

## 7. Sources (checked 2026-11-12)

- Cloudflare: [Pages → start new projects with Workers](https://developers.cloudflare.com/pages/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/), [SSG and 404](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/), [Workers roles and per-Worker scopes](https://developers.cloudflare.com/workers/authorization/workers/) and [changelog 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/), [account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/), [Secrets Store limits](https://developers.cloudflare.com/changelog/post/2025-05-19-paygo-updates/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [additional Free accounts](https://developers.cloudflare.com/fundamentals/account/create-account/), [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (`workers.dev`).
- Alchemy v2: [getting started](https://alchemy.run/getting-started), [static sites](https://alchemy.run/cloudflare/frontend/static-site), [state store](https://alchemy.run/state-store), [CI](https://alchemy.run/environments/ci), [profiles and CI env vars](https://alchemy.run/environments/profiles), [stages](https://alchemy.run/environments/stages), [plan](https://alchemy.run/cli/plan), [deploy](https://alchemy.run/cli/deploy), [destroy](https://alchemy.run/cli/destroy); source of `alchemy@2.0.0-beta.85` and `@alchemy.run/cloudflare@2.0.0-beta.85` (asset config override of `_headers`/`_redirects`, symlink handling, edge-preview secret read, telemetry opt-out `DO_NOT_TRACK`).
- GitHub: [environment branch policies evaluate `refs/pull/<n>/merge` for `pull_request`](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/) (since 2025-12-08).
- Verified locally (no account): `alchemy plan` needs credentials (fails on the first Worker read); `alchemy dev` serves an assets-only Worker offline in workerd and applies the `_headers` rules to 200 and 404 responses.
