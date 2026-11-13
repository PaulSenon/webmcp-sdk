# Docs site deployment

Maintainer runbook for the documentation site (`apps/docs`) on Cloudflare. It covers the architecture, the security design and its threat-model delta, the cost, the **one-time setup**, and day-to-day operations (rollback, teardown, custom domain).

- Infrastructure as code: [`infra/docs`](../infra/docs) (Alchemy v2, private workspace package `@senon/webmcp-sdk-docs-infra`).
- Pipeline: [`.github/workflows/docs.yml`](../.github/workflows/docs.yml).
- **Deploys are off** until the repository variable `DOCS_DEPLOY_ENABLED` is `true` (§4.2). Until then the workflow only builds and checks, without credentials.

## 1. Architecture

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
   │  checkout current main, infra deps only  │   │  newest main commit, or rollback_run_id  │
   │  PR open, not draft, head == built SHA?  │   │  GATE: all required checks of the SHA    │
   │  GATE: all required checks of the SHA    │   │  still head of main? check account+store │
   │  still head? check account + store,      │   │  alchemy deploy --stage production, smoke│
   │  alchemy deploy --stage pr-<n>, smoke    │   └──────────────────────────────────────────┘
   └───────────┬──────────────────────────────┘
               │ url, status        closed / converted_to_draft ─► docs-teardown-preview (destroy)
   ┌───────────▼────────────────────────────────────────────▼──┐  weekly ─► docs-sweep-previews
   │ docs-comment-preview: one marker comment per PR, upserted  │  (destroys pr-<n> of closed,
   │ (pull-requests: write, no Cloudflare secret)               │   draft or deleted PRs)
   └────────────────────────────────────────────────────────────┘

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
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` | Same-origin only. `'unsafe-inline'` for scripts is forced by the prerendered TanStack Start pages (inline serialized router state for hydration, plus the theme script; no per-request nonce on a static site). Verified with zero CSP violations in Playwright under workerd on the real build (pages, client navigation, search, 404). Still blocks third-party scripts, plugins, framing, `<base>` hijack and fetch-based exfiltration. Hash-based policy: §6 |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | `.dev` is HSTS-preloaded already; matters for a custom domain. No `preload` (domain owner's decision) |
| `X-Content-Type-Options` / `X-Frame-Options` | `nosniff` / `DENY` | |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, … all `()` | a docs site needs none |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | process isolation; no hotlinking by other sites |
| `X-Robots-Tag` | `noindex, nofollow` | previews and local stages only |
| `Cache-Control` on `/assets/*` | `public, max-age=31536000, immutable` | content-hashed files (Vite's output dir in `apps/docs`). Deliberately not `/__tsr/*` (client-navigation data named after the function and its arguments, not the content). Everything else keeps Cloudflare's default `public, max-age=0, must-revalidate` + ETag, so a deploy is visible immediately |

Changing the CSP (for example to embed a third-party demo) is an infra PR, reviewed like any security change.

**Why the infra lives in `infra/docs` (not `apps/docs/alchemy.run.ts`):** the deploy jobs check out *only* the infra package and install *only* its dependencies (`pnpm --filter @senon/webmcp-sdk-docs-infra install`, 126 packages, none of the site's toolchain). Keeping it out of the site package makes that separation physical: no site dependency, MDX plugin or TanStack Start/Vite code is installed in a job that holds a Cloudflare token. It also keeps the site thread and the infra changes in separate files.

**Alchemy v2** (`alchemy@2.0.0-beta.85`, `@alchemy.run/cloudflare@2.0.0-beta.85`, `effect@4.1.2`, all exact pins): an Effect-based TypeScript IaC framework ([alchemy.run](https://alchemy.run/getting-started)). The stack is [`infra/docs/alchemy.run.ts`](../infra/docs/alchemy.run.ts): one `Cloudflare.Worker` with `assets`, `workersDev: { enabled: true, previewsEnabled: false }` (no per-version preview URLs that would keep every old build public), observability off (nothing executes). Alchemy v2 is still a **beta** on npm's `latest` tag: pinned exactly, grouped in Dependabot (`docs-infra`), with an escape hatch (§6).

### Stages

| Stage | Worker | State | Who |
| - | - | - | - |
| `production` | `webmcp-sdk-docs` | Cloudflare state store | CI, `main` only, env `docs-production` |
| `pr-<n>` | `webmcp-sdk-docs-pr-<n>` | Cloudflare state store (preview account) | CI, same-repo non-draft PRs into `main`, env `docs-preview`; destroyed on close or conversion to draft |
| anything else (`live_$USER`, `dev_$USER`, …) | `webmcp-sdk-docs-<stage>` | local `.alchemy/` (gitignored) | developers |

The stack refuses mismatches: remote stages require `DOCS_STATE=cloudflare` (set by the workflow only), local stages refuse it. Outside GitHub Actions, `DOCS_STATE=cloudflare` is refused at import unless `DOCS_ALLOW_LOCAL_REMOTE=1` is also set; this matters because `alchemy destroy` does not run the stack program, so the stage checks alone would not stop `alchemy destroy --stage production` from a laptop. A local `alchemy deploy` therefore never reads or writes remote state by accident. `prod`, `pr-x`, `pr-01` are reserved and rejected.

Local development, no Cloudflare account needed:

```sh
pnpm docs:build                                   # once the site exists (apps/docs/out)
cd infra/docs && pnpm dev                         # alchemy dev: serves the build in local workerd with production headers
DOCS_SITE_DIR=../../apps/docs/out pnpm check:local   # same check CI runs: local workerd + smoke test
```

### State store

`Cloudflare.state({ workerName: "webmcp-sdk-docs-state", accountId })` ([State Store](https://alchemy.run/state-store)): a Worker + SQLite Durable Object in the deploy account, state encrypted at rest with a key kept in the account's Secrets Store, bearer token also in Secrets Store. Durable (Cloudflare storage), free (SQLite-backed Durable Objects are on the Free plan: 5 GB, 100,000 requests/day; [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)), not in the repository, locked per stage while a deploy runs. The dedicated `workerName` means it never shares state with any other Alchemy project, and `accountId` is pinned. In CI, Alchemy reads the store's token by uploading an ephemeral *edge preview* of the state-store Worker that binds the secret: that is why the token needs Secrets Store **Edit** ([Alchemy CI](https://alchemy.run/environments/ci), [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/)). Caveat verified in the Alchemy source: `--yes` (required in CI) also authorizes Alchemy to *create* a missing store and to *replace* a store of another version (`updateStateStore`). So the workflow (a) runs `cli.ts check-store` before every `alchemy` call and fails if the bootstrapped store is absent, and (b) always runs the infra of the **current** `main`, never an older commit whose Alchemy would downgrade the store. You bootstrap each store once (§4.2, `scripts/bootstrap.ts`); an Alchemy upgrade merged to main upgrades it on the next deploy.

Alternatives considered: AWS/GCP stores (need a second cloud), Postgres (needs a database), local file state committed to git (rejected: state in the repo, races), R2-backed (needs a payment method on file to enable R2).

### Pipeline

| Job | Trigger | Holds | Runs PR code? |
| - | - | - | - |
| `docs-build` | PR opened/synchronize/reopened/ready_for_review (**drafts included**), push to `main`, dispatch | read-only token | **yes** (site build) |
| `docs-deploy-preview` | same-repo, **non-draft** PR into `main`, not Dependabot, deploys enabled | env `docs-preview` Cloudflare token, `checks: read`, `pull-requests: read` | no: current main's infra + the artifact |
| `docs-teardown-preview` | PR **closed** (merged or not) or **converted to draft** (same repo, any base), or dispatch `destroy_preview` | env `docs-preview` token | no |
| `docs-comment-preview` | after a preview deploy or teardown | `pull-requests: write` only | no (main's `infra/docs`, no dependencies) |
| `docs-sweep-previews` | weekly cron (Mon 04:17 UTC) or dispatch `sweep_previews` | env `docs-preview` token, `pull-requests: read` | no |
| `docs-deploy-production` | push to `main`, dispatch on `main` (rebuild, or `rollback_run_id`) | env `docs-production` token, `checks: read` | no: current main's infra |

- **Draft policy (chosen).** A draft PR builds and is checked like any PR, but gets no preview. `ready_for_review` deploys it; `converted_to_draft` tears it down exactly like `closed`; `reopened` deploys again unless the PR is a draft. Rationale: drafts are work in progress and previews cost a Worker slot (100 per Free account) and public exposure.
- **Deploy gate** ([`src/gate.ts`](../infra/docs/src/gate.ts), one list): a commit deploys, preview or production, only once **every required check run of that exact SHA** is green: `checks`, `browser`, `workflow-lint`, `docs` (ci.yml) and `docs-build` (docs.yml). Read via the check-runs API (`checks: read`), newest run per name, only runs created by the `github-actions` app (another installed app cannot fake a green), polled every 20 s for at most 40 min. Any conclusion other than `success` (failure, cancelled, timed out, skipped, neutral) or the timeout **fails closed**. The deploy jobs are not in the list, so the gate never waits on itself; `docs-build` is finished before the deploy job starts (`needs`). For a preview the SHA is the PR head (GitHub attaches `pull_request` check runs to the head commit).
- **Latest SHA only.** Previews: just before the gate and again right after it, the job reads the PR (`GET /pulls/<n>`) and deploys only if it is open, not a draft, and its head is still the commit this run built; otherwise it skips (the newer push has its own run). Production: deploys only if the run's commit is the head of `main`, checked before and again after the gate (rollback dispatches excepted).
- **PR comment.** Exactly one per PR, found by the hidden marker `<!-- webmcp-sdk-docs-preview -->` *and* authorship `github-actions[bot]` (a human pasting the marker is ignored), updated in place through the REST API (`PATCH /issues/comments/<id>`), created when missing. It shows ✅ deployed (URL, short SHA, run link), ❌ failed, 🧹 removed (closed / draft / manual / sweeper) or ⚠️ teardown failed. A teardown updates an existing comment but never creates one (a PR that never had a preview gets no comment). Values are validated (SHA, `*.workers.dev` URL, run URL) before going into Markdown.
- **Cleanup.** Event-driven teardown on close and on conversion to draft, plus the **weekly sweeper**: it lists the `pr-*` stages in the preview state store (`alchemy state list webmcp-sdk-docs`), reads each PR, and destroys the stage when the PR is closed, a draft or deleted, re-reading the PR right before each destroy. It catches PRs closed while deploys were off, failed teardowns, and PRs GitHub runs no workflow for (merge conflicts: no merge ref). Inert until `DOCS_DEPLOY_ENABLED`. Residual race: a PR reopened between the re-read and the destroy loses its preview until its next push.
- **Account isolation.** Separate environment secrets (`docs-preview` / `docs-production`, each with its own branch policy); stages validated by regex (`production` or `pr-<n>`, and a `case` guard before every alchemy call); before any alchemy call, `check-store` verifies that the token's account serves the workers.dev subdomain expected **for that stage** (so production secrets pointing at the preview account, or the reverse, fail) and that the bootstrapped state store exists; the workflow refuses `DOCS_PREVIEW_WORKERS_SUBDOMAIN` equal to `DOCS_WORKERS_SUBDOMAIN` (or missing) unless `DOCS_SINGLE_ACCOUNT=true` is set deliberately; each account has its own state store.
- **No plan without credentials.** Alchemy's `plan` reads the live account (it fails with an auth error before printing anything), so a PR cannot show a cloud diff without a token. Instead `docs-build` serves the build with `alchemy dev` in local workerd (the same asset router, with the PR's headers and 404 config) and runs the post-deploy smoke test against it. The cloud diff is printed by `alchemy deploy` in the deploy job logs.
- **Concurrency.** Build: per PR, cancels superseded PR builds (never main). Deploys: `docs-preview-<n>` and `docs-production`, `cancel-in-progress: false`, so an in-flight deploy is never interrupted and the newest pending run wins. Re-running an old production run is a no-op (it is no longer the head of `main`); roll back with `rollback_run_id`. A preview deploy whose PR was closed or drafted meanwhile is skipped, so it cannot resurrect a preview after teardown.
- **Smoke test** ([`src/smoke.ts`](../infra/docs/src/smoke.ts)), after every deploy: waits (up to 3 min) until `/` serves the uploaded `index.html` byte for byte (proves the new version is live), checks every security header, `noindex` iff preview, an unknown path returns 404 with the uploaded `404.html`, `_headers`/`_redirects` are not served, an `/assets/` file referenced by `index.html` is `immutable`, and a page directory is served at `/<dir>` with `/<dir>/` redirecting to it. Headers on the 404 response are a warning only: Cloudflare does not document whether `_headers` applies to `404-page` responses (local workerd does apply them).
- **Hygiene** (same as `ci.yml`/`release.yml`): `permissions: {}` at the top, least privilege per job, actions pinned by SHA (only GitHub-owned + `pnpm/action-setup`), Alchemy called through `pnpm exec` (no third-party action), `persist-credentials: false`, every expression in `run:` passed through `env:`, `cache-mode: none` and `package-manager-cache: false` on every job, zizmor **pedantic** (also in CI: `persona: pedantic`) and actionlint clean, Alchemy telemetry off (`DO_NOT_TRACK=1`; it is on by default and sends anonymised usage to `otel.alchemy.run`).
- **Required checks.** `pnpm test:infra` (typecheck + unit tests) runs inside the existing required `checks` job. Recommendation once #6 is merged: add `docs` and `docs-build` to the ruleset (both always report; §4.2 step 5). Never the deploy jobs.

## 2. Threat model delta (vs [`02-threat-model.md`](release-research/02-threat-model.md))

The Cloudflare design replaces GitHub Pages (D3) and changes T13/T17; T3/T7 are unchanged and apply to the new jobs.

| # | Threat | Controls | Residual |
| - | - | - | - |
| **T13'** | **Malicious docs deploy / defacement** | production token only in env `docs-production` (branch policy `main`, no admin bypass), so it needs a merged PR (ruleset); preview token in env `docs-preview` (policies `main`, `refs/pull/*/merge`); fork PRs get no secrets and no preview job; no `pull_request_target`/`workflow_run`; Dependabot PRs excluded; **separate Cloudflare account for previews** so the preview token cannot reach production; production token scoped to two Workers (Editor, cannot create or delete) | a writer can edit `docs.yml` in a same-repo PR and use the *preview* token: contained to the preview account **only with two accounts** (in single-account mode this is a production compromise for any writer). The build job's outputs are untrusted: deploy jobs recompute stage/URL and compare. A merged malicious change deploys (rollback §5) |
| **T17'** | **Docs build compromise** (site deps, MDX, plugins run in the build) | build job has no secret, no write token, no cache; deploy jobs never install site deps (infra-only filtered install from the **current main**); artifact validated as data: regular files only, no symlinks (Alchemy uploads a symlink's target), no control characters in names (log-command forgery), no `.env*`/`.npmrc`/`.git`/`*.pem`, Cloudflare limits; headers/redirects from infra, overriding the build's | a compromised build can still serve malicious static content (that is its job); CSP limits it to same-origin script, no exfiltration via `connect-src`. Detection: review of the deployed diff is manual |
| T20 | **Cloudflare token theft** | per-environment tokens; account-owned `cfat_` tokens (scannable by GitHub secret scanning); production: Workers Editor on 2 Workers + Secrets Store Edit, in a dedicated account (nothing else to reach); expiry set (1 year); masked by GitHub; never passed to steps other than `alchemy deploy/destroy`; no caches in those jobs | stolen production token can overwrite the site and read/write its state; revoke in Cloudflare (§5). I found no Cloudflare-documented exchange of a GitHub OIDC token for API credentials (2026-11-12), so the token is static; switch to it if Cloudflare ships one |
| T21 | **State store tampering / leak, account mix-up** | state encrypted at rest, store token in Secrets Store, store reachable only with the deploy token; separate stores per account; local stages cannot use it; `check-store` refuses a token whose account does not serve the stage's expected subdomain; equal production/preview subdomains refused unless `DOCS_SINGLE_ACCOUNT=true` | anyone with the deploy token can read state (Worker names, hashes; no secret values: the site has none) |
| T22 | **Preview abuse** (phishing on our workers.dev, cookie tossing) | previews only for writers' PRs; `noindex`; separate account ⇒ different registrable domain (`workers.dev` is on the Public Suffix List, so each account subdomain is its own site); the site sets no cookies; previews destroyed on close | previews are public while the PR is open (Access gating: §6) |
| T23 | **Alchemy / Effect supply chain** (beta framework with the token) | exact pins, lockfile, pnpm `minimumReleaseAge` 3 d, Dependabot cooldown 7 d, `docs-infra` group reviewed as a unit; the only install script in the infra tree (`workerd`) is disabled; telemetry off | a malicious Alchemy release that passes review runs with the deploy token. Bounded by the token scope above |
| T24 | **Out-of-order, stale or unchecked deploy** | gate on every required check of the exact SHA (fail closed, `github-actions` app only), `cancel-in-progress: false`, head-of-main and PR-head checks before and after the gate, draft/closed checks, smoke test compares served bytes with the artifact; rollback deploys a validated old artifact (successful `docs` push run on `main`, same repo) with the current infra | anyone with write access can dispatch a rollback (no reviewers on `docs-production`); add a required reviewer there if a 2nd maintainer joins |

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

## 4. One-time setup

Split by who must do it. **Isaac** does only what needs his Cloudflare login, his 2FA or a decision. **An agent** (or Isaac, same commands) does the rest from a workstation with `gh` logged in as a repository admin. Nothing here goes in the repository, no token ever appears in chat, argv, logs or shell history.

Order: §4.0 merge plan, then (a), then (b). About 15 minutes of Isaac's time.

### 4.0 Merge order and staging

1. Merge **#7** (this PR): infra inert, CI checks it against the fixture site.
2. Rebase **#6** (the site) onto `main` and regenerate the lockfile (`pnpm install`, never by hand). Its `ci.yml` adds the `docs` job; resolve the `ci.yml` conflict by keeping both #6's `docs` job and #7's `persona: pedantic`.
3. Do (a) and (b) below, including `DOCS_DEPLOY_ENABLED=true`. Then push to #6 (or *Re-run all jobs* of its latest docs run): **#6's preview is the staging site** (`https://webmcp-sdk-docs-pr-6.<preview-sub>.workers.dev/`). It deploys only once every required check of #6's head is green (`checks`, `browser`, `workflow-lint`, `docs`, `docs-build`), and its URL is posted in the PR comment. Isaac reviews the content there; every push redeploys it.
4. Merging **#6** tears the preview down and deploys production from the merge commit, again only once all its required checks are green.

Why it works with this design: deploy jobs check out **main's** infra (present after step 1), while `docs-build` builds #6's own `apps/docs`. Until #6 is merged, `main` has no `apps/docs`, so production deploy jobs are skipped (`has_site` false) instead of waiting for a `docs` check that does not exist on main yet.

### 4.1 (a) Isaac only

**1. Log in, 2FA.** <https://dash.cloudflare.com/login>. *My Profile* (top-right menu) → **Authentication** → **Add** next to *Security Key Authentication* (or *Mobile App Authentication* first, which security keys require), and save the backup codes ([2FA](https://developers.cloudflare.com/fundamentals/user-profiles/2fa/)). Your existing Workers Paid subscription stays on your personal account; nothing here changes it.

**2. Decide: one account or two.** Recommended: **two** (`webmcp-sdk-docs` for production, `webmcp-sdk-docs-preview` for previews). The preview token must be Workers **Admin** (it creates and deletes Workers), so in a shared account it could overwrite production; with two accounts it cannot reach production at all, and only a merge to `main` changes production. One account is acceptable while you are the only person with write access to the repository; then set the repository variable `DOCS_SINGLE_ACCOUNT=true` (the workflow refuses equal production/preview subdomains without it).

**3. Create the account(s).** Dashboard → **Accounts** (account list) → **Create Account** → name → **Create Account** ([create account](https://developers.cloudflare.com/fundamentals/account/create-account/): your user must be ≥ 7 days old and Super Administrator of an existing account; up to 5 extra Free accounts). Free plan, no payment method, same login. This step cannot be done with an account API token: the API (`POST /accounts`, `standalone: true`) needs a *user* token, and Alchemy's `Cloudflare.Account` resource only supports the partner/tenant API (`AccountCreationForbidden` for standard users; checked in its source).

**4. Copy each Account ID.** In the account: **Search** (Cmd/Ctrl-K) → *Copy account ID*, or **Workers & Pages** → *Account Details* → **Account ID** ([find IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)). Not a secret, but stored as one.

**5. workers.dev subdomain.** Nothing to do: the bootstrap creates it by API if the account has none (`PUT /accounts/{id}/workers/subdomain`, permission Workers Scripts Write, [API](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/)). Only choose the names, for example `webmcp-sdk-docs` and `webmcp-sdk-docs-preview` (globally unique; if taken, pick another). If you already opened **Workers & Pages** and accepted a proposed subdomain, the bootstrap keeps it and never changes an existing one.

**6. Create one token per account.** In that account: **Manage Account** → **API Tokens** (Account API Tokens) → **Create Token** → **Create Custom Token** ([account tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). Name, permissions below, **Token expiration**: 1 year (calendar reminder). No *Client IP Address Filtering* (GitHub-hosted runners have no fixed IPs). **Continue to summary** → **Create Token**. The value is shown once.

| Account | Token name | Permission | Scope | Level |
| - | - | - | - | - |
| preview | `github-docs-preview` | Workers | All Workers (product) | **Admin** |
| preview | | Secrets Store | Account | **Edit** |
| production | `github-docs-production` | Workers | All Workers (product) | **Admin** (temporary, see step 8) |
| production | | Secrets Store | Account | **Edit** |

Why these: the same token bootstraps the state store (creates the `webmcp-sdk-docs-state` Worker, its Durable Object, a Secrets Store and two secrets), creates the workers.dev subdomain, and deploys. Secrets Store **Edit**, not Read, because Alchemy reads the store's token in CI through an edge preview that *binds* the secret ([Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/)). If the account-token form does not offer Secrets Store, create the same token as a user token (*My Profile* → **API Tokens**) restricted to that one account.

**7. Hand each token to the agent, never through chat.** The agent opens a local secure input card (T3 `request_secret` with `delivery: "file"`); you paste the token there. It lands in a temporary file readable only by you; the agent passes the file path to the scripts and deletes it afterwards.

**8. Narrow the production token (after (b) step 4).** Production account → **Manage Account** → **API Tokens** → `github-docs-production` → **Edit**: replace *Workers / All Workers / Admin* with

| Permission | Scope | Level |
| - | - | - |
| Workers | All Workers (product) | **Metadata Read-Only** (Alchemy reads the account's subdomain and lists Workers) |
| Workers | **Specified Workers**: `webmcp-sdk-docs`, `webmcp-sdk-docs-state` | **Editor** (deploy; cannot create or delete) |
| Secrets Store | Account | **Edit** |

([per-Worker roles](https://developers.cloudflare.com/workers/authorization/workers/)). The token value does not change. Then let the agent re-run the production deploy. If it fails with a 403 (per-Worker scoping of the state store's edge preview is not verified live), use Workers **Editor** at product scope instead: still cannot create or delete Workers. Never go back to Admin.

### 4.2 (b) Agent steps

Run from the repository root on an up-to-date `main` (`git pull`, `pnpm install --frozen-lockfile`), with `gh` logged in as a repository admin. `TOKEN_FILE` is the file from (a) 7. No `set -x`.

**1. Bootstrap each account** ([`infra/docs/scripts/bootstrap.ts`](../infra/docs/scripts/bootstrap.ts), idempotent, safe to re-run):

```sh
node infra/docs/scripts/bootstrap.ts --role preview    --account-id <preview id>    --token-file "$TOKEN_FILE" --subdomain <preview sub>
node infra/docs/scripts/bootstrap.ts --role production --account-id <production id> --token-file "$TOKEN_FILE" --subdomain <production sub>
```

It verifies the token (`/accounts/{id}/tokens/verify`, else `/user/tokens/verify`) and prints only its kind, status and expiry, the account name and ID; ensures the workers.dev subdomain (creates it only if missing, never renames); runs `alchemy state bootstrap` non-interactively if the store is absent (environment credentials, `CI=true`, no profile, no OAuth, throwaway home and working directory so no Alchemy log persists, token redacted from any output); re-checks the store; prints the commands for the next step. `--check` only reads. The token is never accepted on argv.

**2. GitHub secrets and variables** (token through stdin only):

```sh
gh secret set CLOUDFLARE_API_TOKEN  --env docs-preview    < "$PREVIEW_TOKEN_FILE"
printf %s <preview id>    | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-preview
gh secret set CLOUDFLARE_API_TOKEN  --env docs-production < "$PRODUCTION_TOKEN_FILE"
printf %s <production id> | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-production
gh variable set DOCS_WORKERS_SUBDOMAIN         --body <production sub>
gh variable set DOCS_PREVIEW_WORKERS_SUBDOMAIN --body <preview sub>      # two accounts
# one account instead: gh variable set DOCS_SINGLE_ACCOUNT --body true  (and no preview variable)
rm -f "$PREVIEW_TOKEN_FILE" "$PRODUCTION_TOKEN_FILE"
```

The environments `docs-production` (branch policy `main`) and `docs-preview` (`main`, `refs/pull/*/merge`) already exist, without reviewers and without admin bypass.

**3. Enable:** `gh variable set DOCS_DEPLOY_ENABLED --body true`.

**4. Verify.** Staging: push to #6 (or re-run its docs run); check `docs-deploy-preview` green, the smoke-test summary all ✅, the PR comment with the URL. After #6 is merged: `docs-deploy-production` green and `https://webmcp-sdk-docs.<production sub>.workers.dev/` served. Then ask Isaac for (a) 8, and dispatch `gh workflow run docs.yml --ref main` to confirm production still deploys with the narrowed token. Optional: convert a test PR to draft and back to check teardown/redeploy and the comment updates; `gh workflow run docs.yml --ref main -f sweep_previews=true` for the sweeper.

**5. Required checks.** Propose to the coordinator/Isaac (rulesets are not edited by this PR) adding `docs` and `docs-build` to the `main` ruleset's required status checks, next to `checks`, `browser`, `workflow-lint`, `dependency-review`. The deploy jobs (`docs-deploy-*`, `docs-teardown-preview`, `docs-comment-preview`, `docs-sweep-previews`) must **not** be required: they are skipped on most events.

Pause everything at any time: `gh variable set DOCS_DEPLOY_ENABLED --body false`.

## 5. Operations

| Situation | Do |
| - | - |
| Bad content in production, now | **Cloudflare dashboard → production account → Workers & Pages → `webmcp-sdk-docs` → Deployments → previous version → Rollback** (instant, no CI). Then fix forward on `main` (revert PR); the next deploy differs from what state recorded, so it uploads |
| Roll back to a given commit | Actions → **docs** → *Run workflow* on `main`, `rollback_run_id` = the id of a successful docs run of that commit (in its URL `/actions/runs/<id>`). The job checks it is a push run on `main` of this repo, then deploys its `docs-site-production` artifact (kept 90 days) with the current infra. CLI: `gh workflow run docs.yml --ref main -f rollback_run_id=<id>`. Re-running an old run does nothing (it is no longer the head of main) |
| A preview was not removed (deploys were off, job failed) | wait for the weekly sweeper, or now: Actions → docs → *Run workflow* on `main` with `destroy_preview` = PR number (or `sweep_previews` ticked) |
| A deploy waits, then fails at *Gate* | a required check of that commit failed or is still missing after 40 min: fix it or re-run it, then re-run the deploy job |
| `check-store` fails | wrong secrets for this environment (the account's workers.dev subdomain is not the expected one) or the store was never bootstrapped: §4.2 step 1 |
| Smoke test failed after deploy | the deploy is live: read the summary; roll back as above if users are affected |
| Token leaked or suspicious | Cloudflare → *Account API tokens* → **Roll** or delete; update the env secret; review *Audit logs*. Production token compromise: also check *Deployments* for unknown versions |
| Rotate yearly | *Roll* the token, hand it over as in §4.1 step 7, `gh secret set CLOUDFLARE_API_TOKEN --env … < file` |
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
2. **Cloudflare Access on previews** (Zero Trust Free, 50 users): previews visible only to you. Adds an Access app and a token permission.
3. **Drift detection**: scheduled `alchemy drift` against production (read-only token) and an uptime check of the production URL.
4. **Escape hatch if Alchemy v2 stalls**: the same site deploys with Wrangler (`assets.directory`, `not_found_handling`, `html_handling`, `_headers` from `cli.ts headers`), with the same tokens and workflow structure.
5. **Versioned docs** (D8: stable at `/`, `main` at `/next/`) once there is a release: build both into one directory before upload; the infra does not change.

## 7. Sources (checked 2026-11-12/13)

- Cloudflare: [Pages → start new projects with Workers](https://developers.cloudflare.com/pages/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/), [SSG and 404](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/), [Workers roles and per-Worker scopes](https://developers.cloudflare.com/workers/authorization/workers/) and [changelog 2026-09-15](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/), [account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Secrets Store access control](https://developers.cloudflare.com/secrets-store/access-control/), [Secrets Store limits](https://developers.cloudflare.com/changelog/post/2025-05-19-paygo-updates/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [additional Free accounts](https://developers.cloudflare.com/fundamentals/account/create-account/), [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (`workers.dev`).
- Alchemy v2: [getting started](https://alchemy.run/getting-started), [static sites](https://alchemy.run/cloudflare/frontend/static-site), [state store](https://alchemy.run/state-store), [CI](https://alchemy.run/environments/ci), [profiles and CI env vars](https://alchemy.run/environments/profiles), [stages](https://alchemy.run/environments/stages), [plan](https://alchemy.run/cli/plan), [deploy](https://alchemy.run/cli/deploy), [destroy](https://alchemy.run/cli/destroy); source of `alchemy@2.0.0-beta.85` and `@alchemy.run/cloudflare@2.0.0-beta.85` (asset config override of `_headers`/`_redirects`, symlink handling, edge-preview secret read, telemetry opt-out `DO_NOT_TRACK`).
- GitHub: [pull_request activity types incl. `ready_for_review`, `converted_to_draft`; no secrets for forks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [check runs API](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference), [environment branch policies evaluate `refs/pull/<n>/merge` for `pull_request`](https://github.blog/changelog/2025-11-07-actions-pull_request_target-and-environment-branch-protections-changes/) (since 2025-12-08).
- Alchemy, verified in the beta.85 source: `alchemy state bootstrap` sets `updateStateStore: true` and resolves credentials from `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` with `CI=true` (no profile, no prompt); exercised up to the account-access check with a dummy token. `Cloudflare.Account` uses the tenant API only.
- Verified locally (no account): `alchemy plan` needs credentials (fails on the first Worker read); `alchemy dev` serves an assets-only Worker offline in workerd and applies the `_headers` rules to 200 and 404 responses.
