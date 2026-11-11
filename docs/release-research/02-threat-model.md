# 02 — Publication threat model (compact)

Scope: everything that can cause bytes to appear under `<pkg>` on npm, or docs on the official site, that the maintainer did not intend. Out of scope: runtime vulnerabilities in the SDK's own code, GitHub/npm platform compromise.

## Assets and authorities

| Asset | Who can change it (target state) |
|---|---|
| npm `<pkg>` versions | **only** `release.yml` → job `stage` in env `npm-release` (OIDC, stage-only) **+** maintainer 2FA approval on npm |
| npm dist-tags, deprecations, owners, package settings | maintainer CLI/UI with 2FA (no CI authority) |
| `main`, `next` branches | merged PRs per ruleset; maintainer (admin bypass, used deliberately) |
| tags `<pkg>@*`, GitHub Releases | `release.yml` → job `finalize` (`contents: write`); existing tags immutable via ruleset + immutable releases |
| Docs site | `docs.yml` → env `github-pages` (branch/tag policy: `main`, `<pkg>@*`) |
| Workflow definitions | merged PRs; CODEOWNERS on `.github/` once there is a 2nd maintainer |

Trust boundaries: (1) fork / PR code, (2) dependencies and build tools executed in CI, (3) third-party actions, (4) the GitHub repo/account, (5) the npm account, (6) the maintainer's machine.

## Threats → controls → residual

| # | Threat | Primary controls | Residual / detection |
|---|---|---|---|
| T1 | **Fork PR gets privileged execution** (pwn request) | no `pull_request_target`/`workflow_run`; PR CI has `permissions: contents: read`, no secrets, no `id-token`; fork workflows require approval for all outside contributors | maintainer approves a malicious PR's CI run: still unprivileged |
| T2 | **Script injection** via PR title/branch/filenames in `${{ }}` | untrusted contexts only through `env:` + quoted shell; zizmor `template-injection` required | new workflows not linted locally (CI catches them) |
| T3 | **Cache poisoning** reaches the release (TanStack) | `build` and `stage` jobs use `cache-mode: none`, `setup-node` `package-manager-cache: false`; release runs only from `main`/`next` via dispatch; PR caches are scoped to their merge ref | non-release CI may use caches; it holds no authority |
| T4 | **Compromised dev dependency / build tool** runs in CI | frozen lockfile; `strictDepBuilds` + empty `allowBuilds`; `minimumReleaseAge` 3d strict; `trustPolicy: no-downgrade`; `blockExoticSubdeps`; Dependabot cooldown 7d; **`build` job has no `id-token`, no write token**; `stage` job runs no dependency code | malicious code can still tamper with the **artifact** in `build`. Mitigated by tarball diff in the run summary, human review at npm approval, consumer tests. Not eliminated |
| T5 | **OIDC token theft** from a privileged job | the only job with `id-token: write` runs no repo checkout, no deps, no cache; downloads one artifact and runs bundled npm with `--ignore-scripts`; trust is **stage-only**, so a stolen token can only *stage* | attacker stages a version; approval checklist step 1 (single expected pending stage) catches it → reject. Whether npm notifies maintainers of new stages is unverified, so check `npm stage list` |
| T6 | **Stolen GitHub credential / push access** (PAT, session, malicious collaborator) | publishing needs dispatch + env `npm-release` (branch policy `main`/`next`) **and** npm 2FA approval; ruleset on `main` (PR required, required checks, no force push, no routine bypass); workflow changes go through PR | with admin rights an attacker can change rulesets/env/workflows, but still cannot complete a publish without npm 2FA |
| T7 | **Compromised third-party action** (tag retarget) | full-SHA pins enforced by `sha_pinning_required`; minimal action set (GitHub-owned + `pnpm/action-setup`); Dependabot proposes pin bumps, reviewed by a human | a malicious commit merged upstream *and then* pinned by us via a careless bump |
| T8 | **npm account takeover** (phishing) | WebAuthn/passkey 2FA; "require 2FA and disallow tokens"; no tokens exist; minimal owners list | attacker with a live 2FA session can publish directly; root of trust = maintainer |
| T9 | **Package name confusion / typosquat** | rename to an owned scope (D1); README and docs point only to `<pkg>`; optionally make the old name's docs explicit ("not affiliated with `webmcp-sdk` on npm") | users still mistype; unscoped look-alikes cannot be prevented |
| T10 | **Wrong bytes / wrong commit published** (rebuild drift, retry repacks, tampering inside `build`) | pack once; sha512 from `build` checked in `stage` and `finalize` against the registry `dist.integrity`; tag at the recorded SHA; version immutable on npm; **local rebuild + content diff before approval** | equality is with *that run's build output*. A compromised build can make bytes ≠ source + tests and forge its own manifest. Only the local diff (03 §4) detects that |
| T11 | **Partial release** (published, no tag/release; stage pending from a lost run; staged, never approved) | `finalize` re-runnable with explicit tag/draft/release state table; stage ID in summary; manual runbook for old runs (registry bytes + `npm audit signatures` + SLSA fields) | manual steps; `GITHUB_TOKEN` cannot create a release whose target has different workflow files (manual `gh` then) |
| T12 | **Release tag forged / moved** | tag ruleset: block update+deletion of `<pkg>@*`; immutable releases lock tag; tags are a *record*, never a trigger | tag *creation* by a writer is possible but has no effect on npm |
| T13 | **Docs defacement / malicious docs deploy** | `docs.yml` only from `main` or release tags via env branch policy; no fork deploys; Pages identity cannot publish npm (different workflow filename) | a merged malicious docs change deploys. Rollback = redeploy previous tag |
| T14 | **Approval fatigue / social engineering of the approver** | finalize summary lists files, sizes, integrity, diff vs previous published tarball; checklist in release runbook | human factor; cannot be engineered away |
| T15 | **Settings drift** (tokens re-enabled, ruleset removed) | settings recorded in 03 §5 as a checklist; optional periodic Scorecard / `gh api` diff (D9) | undetected without periodic check |
| T16 | **Bot-authored malicious change** (a Dependabot PR carrying a compromised version; a future version-PR GitHub App with write authority) | bots get no special-casing in workflows; bot PRs reviewed as untrusted (lockfile diff: new packages, hooks, git/URL sources); cooldown ≥ release age; no auto-merge in v1; any App: minimal permissions, single repo, key kept out of CI | reviewer misses a malicious transitive update; release age + approval checklist are the remaining layers |
| T17 | **Docs build compromise** serving phishing/malicious content from the official origin (MDX/plugins/old-tag deps execute in the build) | same pnpm policy; no secrets in docs jobs; pinned docs toolchain; deploy only from `main`; rollback to a known-good Pages artifact | cannot reach npm, but can damage users through the docs; detection is manual |
| T18 | **Dispatch input / release-notes injection** (crafted `confirm_version`, changelog prose with shell metacharacters or Markdown links) | inputs only via `env:`; strict semver validation; Node helpers use `execFile` + `--notes-file`; notes come from the reviewed CHANGELOG at the SHA | malicious-but-reviewed prose is displayed as written |
| T19 | **Maintainer device compromise** (session theft on both GitHub and npm) | WebAuthn; device hygiene; recovery runbook (03 §4) from a clean device | GitHub and npm approvals from the same compromised device aren't independent; this is the root of trust |

## What an attacker needs to ship malicious bytes to `latest`

1. Get malicious bytes into the tarball (review bypass, T4, or a malicious maintainer commit), **and**
2. get them staged (a legitimate dispatch, or T5), **and**
3. **pass the maintainer's npm 2FA approval** (T8/T14).

Every automated path stops at step 3. That is the design's central guarantee, and its limit: the human approval step is real only if the approver looks.
