# 04 — Inventory, gaps, migration plan, acceptance, tests

## 1. Read-only inventory (2026-11-11, `main` @ `9e4a65e`)

Commits observed during the study: `8ebceae` (core runtime), `9e4a65e` (React bindings) from the runtime thread. React is now implemented. An earlier sub-report saw `notImplemented` stubs; that is outdated.

| Area | Current state | Source |
|---|---|---|
| Layout | single package at repo root: `src/` (core + `src/react/`), `tests/` (vitest, FAKE model context, SSR, `tests/browser/` Playwright Chromium + `@w3c/webmcp-polyfill`), `type-tests/`, `scripts/check-readme.mjs`, `docs/*.md` (design notes) | `git ls-files` (38 files) |
| Manifest | `name: webmcp-sdk` (**taken on npm by a third party**), `version: 0.0.0-design`, `private: true`, `type: module`, `sideEffects: false`, `exports` → **`.ts` sources**, react `>=18` optional peer, 1 runtime dep `@standard-schema/spec ^1.1.0`. No `files`, `engines`, `packageManager`, `repository`, `publishConfig` | `package.json` |
| Build | none. `tsconfig.json` has `noEmit: true` and `paths` aliasing `webmcp-sdk` → `./src` (masks packaging errors). TS `^7.0.2` | `tsconfig.json` |
| Tests | unit tests (FAKE model context), SSR test, browser tests with the official polyfill. They import **relative `src`**, so they validate behavior but not the published exports | `tests/` |
| Docs check | extracts fenced `ts`/`tsx` blocks from README + immediate `docs/*.md` (except `research.md`) into `.readme-check/`, typechecks them with the root tsconfig, so through `paths`, not through the package | `scripts/check-readme.mjs` |
| Toolchain | local pnpm 10.33.3, Node 24.13.1. Lockfile v9.0, `autoInstallPeers: true`. No `pnpm-workspace.yaml`, no `.npmrc`, no `.nvmrc` | lockfile, local env |
| CI/CD | **no `.github/` at all**: no workflows, no Dependabot, no CODEOWNERS, no SECURITY.md | repo tree |
| GitHub settings | public, personal account (no merge queue possible); default branch `main` **unprotected**, **no rulesets**, **no environments**, no tags, no releases, Pages off; Actions: all actions allowed, `sha_pinning_required: false`, default token **read**, Actions cannot approve PRs; merge commit/squash/rebase all allowed; wiki on | `gh api` (read-only) |
| npm | not published; target name unavailable (README §0); no npm session on this machine (`ENEEDAUTH`) | `npm view`, `npm whoami` |
| Docs site | none | — |

## 2. Gaps vs target

| # | Gap | Severity | Fixed in phase |
|---|---|---|---|
| G1 | Package name collides with an existing, active npm package; README instructs installing it | **blocker** | 0 (decision) + 2 (rename) |
| G2 | `exports` point to `.ts`, no build, no `files`, `private: true` | blocker for publish | 2 |
| G3 | Type/docs checks go through `paths`, never through package exports or a tarball | high (silent breakage) | 2 |
| G4 | No CI; `main` unprotected | high | 1 |
| G5 | No pinned toolchain (`packageManager`, `.nvmrc`), no pnpm supply-chain settings | medium | 1 |
| G6 | No versioning/changelog machinery | needed for release | 2 |
| G7 | No release workflow, no npm trust, no environments | needed for release | 3 |
| G8 | No docs site / deploy | needed for site | 4 |
| G9 | No security policy, vuln reporting, secret scanning confirmation | medium | 1 |
| G10 | Actions policy permissive (all actions, no SHA enforcement) | medium (no workflows yet = no exposure today) | 1 |

## 3. Ordered migration plan

Each phase is a separate PR (or settings session) with its own acceptance. Phases 0–1 don't touch runtime files and can run alongside the runtime thread. Phase 2a touches `package.json`/`tsconfig`/the README imports, so coordinate it. **Phase 2b moves files and must be scheduled when the runtime thread has merged and is idle.**

### Phase 0 — decisions and accounts (owner, no code)
1. Decide D1 (name/scope), D2 (npm org vs user scope), D3 (docs host), D4 (support floors), D5 (second maintainer?).
2. Create the npm org/scope if chosen. WebAuthn 2FA on the account.
3. Optional: change the GitHub repo description and README to mention the final package name early. That removes the T9 confusion even before the first publish, since today the README sends users to an unaffiliated package. This is a one-line docs change that the runtime thread can absorb.

**Accept:** name decided and recorded; scope exists and is owned by the maintainer (screenshot or `npm org ls` output).

### Phase 1 — CI and guard rails on the current flat layout (small PR, no file moves)
1. Add `packageManager` (exact pnpm 11.x + hash), `.nvmrc`, `pnpm-workspace.yaml` with only the supply-chain settings (`packages: ["."]` or none; check pnpm accepts a settings-only file). Regenerate the lockfile **with the same pnpm major chosen**. Coordinate this with the runtime thread, because a lockfile rewrite conflicts with any concurrent dependency change.
2. Add `.github/workflows/ci.yml` (jobs `checks`, `browser`, `workflow-lint`, `dependency-review` from 03 §1, paths adjusted to the flat layout), `.github/dependabot.yml`, `SECURITY.md`.
3. Settings: Actions policy (selected + SHA pinning), fork approval for all outside contributors, `main` ruleset with the required checks, secret scanning/push protection, private vulnerability reporting, release immutability.

**Accept:** CI green on a PR; zizmor reports 0 findings; a test PR from a fork (or a second account) runs only after approval and has a read-only token; a direct push to `main` is refused for non-bypass actors; a Dependabot PR appears and passes (or fails only on release-age, which is expected).

### Phase 2a — make the current root package publishable, in place (no file moves)
This is the most valuable step: it is what makes published exports actually work.
1. `package.json`: final name (D1), `version: 0.0.0` (the first real version comes from a changeset), `files: ["dist"]`, compiled `exports`, `publishConfig: { access: public }` (and nothing else in `publishConfig`), `repository`, `engines` (consumer floor, D4), `homepage`, `bugs`. Remove `private: true` only in the release PR, or keep it until phase 3 and let `plan` refuse a private package.
2. `tsconfig.build.json` (emit `dist/` with `.js` + `.d.ts`, `rootDir: src`). **Remove the `paths` aliases.** Unit/browser tests may keep relative `src` imports: they test behavior, not packaging. Type-tests and docs snippets resolve `<pkg>` through package self-reference to the **built** `dist`, so every job builds before checking (D08).
3. `scripts/check-readme.mjs`: resolve the package through exports instead of `paths`. Make it recursive later, when `apps/docs` exists.
4. Changesets 3: `.changeset/config.json` (`baseBranch: main`, `access: public`, changelog generator pinned). Add `tooling/release/check-changeset.mjs` (03 §1 rule). First changeset `minor` → `0.1.0` (D4).
5. `tooling/consumers/` fixtures + `tooling/release/pack.mjs` + CI `package` job.
6. Update all README/docs imports from `webmcp-sdk` to `<pkg>`.

**Accept:** checklist §4 "Package" passes in CI; tarball content list = expected; no `.ts` source, test or fixture in it.

### Phase 2b — monorepo layout (rename-only PR, during a runtime freeze; can wait for phase 4)
1. `git mv src tests type-tests vitest*.ts tsconfig*.json CHANGELOG.md → packages/sdk/`. The root `package.json` becomes `private` with workspace scripts; add `packages:` to `pnpm-workspace.yaml`. Add `repository.directory`.
2. `tsconfig.base.json` shared. Keep the release scripts path-agnostic (package dir as a parameter), so phase 3 doesn't care which layout is in place.
3. Design notes in `docs/*.md` stay in the repo (internal), not in the public site (D8).

**Accept:** CI identical before/after (same tarball file list and contents hash, except `repository.directory`); `git log --follow` works for moved files.

### Phase 3 — release pipeline + npm bootstrap
1. Add `tooling/release/{plan,pack,finalize}.mjs` + `release.yml` (03 §2). Create environments `npm-release`, `release-finalize`. Tag ruleset.
2. **Dry-run without credentials** (see §5 R0–R3): dispatch on a scratch branch → plan must refuse. Temporarily dispatch with a `dry_run` input, or run the same scripts locally, so that plan + build + pack run and `stage` is skipped.
3. **Bootstrap the package and its trust** (D11 of the review). npm documents that **staging can create a new package** and that a **rejected stage can be re-staged under the same version**. Whether a trusted-publisher config can be created *before* the package exists is **not** documented. So:
   - Step 1, an explicit provenance exception: the maintainer, logged in with 2FA, stages a placeholder `0.0.0-bootstrap.0` built by CI (`npm stage publish ./pkg.tgz --tag bootstrap`) and approves it. This version has **no CI provenance**, which is acceptable because it is a placeholder, never a real release. Record it as such in the CHANGELOG/release notes. If the npm UI does allow creating a trust config for an unpublished name at that time, skip this step and note it.
   - Step 2: configure the trusted publisher (stage-only, `release.yml`, `npm-release`). **Within 2 days**, run the first real `release.yml` (`0.1.0`), because that publish validates the config.
   - Step 3: enable "require 2FA and disallow tokens"; `npm dist-tag rm <pkg> bootstrap`; deprecate `0.0.0-bootstrap.0` ("placeholder").
4. First real release `0.1.0` through the full flow: stage → approval checklist → npm 2FA approve → finalize → immutable release → docs dispatch.

**Accept:** checklist §4 "Release" passes; `npm view <pkg>@0.1.0 dist.integrity` = manifest integrity; provenance visible on npmjs and verifiable (`npm audit signatures` in a scratch consumer); `gh release verify <pkg>@0.1.0` passes; the tag is at the manifest SHA; package setting shows tokens disallowed.

### Phase 4 — docs site
1. `apps/docs` (Starlight, private). Content: Getting started (from README), Guides, API reference (hand-written for the two entry points first), Changelog page rendered from `packages/sdk/CHANGELOG.md`.
2. `docs.yml` (03 §3). Pages source = Actions. `github-pages` env branch policy.
3. Before the first release: only `/` = main + banner. After: stable/next split.

**Accept:** site is reachable; footer shows version + SHA; a fork PR produces a downloadable `docs-preview` artifact and **no deployment**; rollback by `stable_ref` works (R9).

### Phase 5 — optional, only when justified
`next` prerelease branch (when a breaking change needs a soak period) · Netlify fork previews (D3) · version PR bot via GitHub App (D6) · Scorecard + settings drift check (D9) · pkg.pr.new PR builds (D7) · TypeDoc/Twoslash (when their TS 7 support lands) · second package split (only on a trigger from README §1.1).

## 4. Acceptance checklist (target state)

**Package**
- [ ] Tarball contains only `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `dist/**` (`.js`, `.d.ts`, and maps only if their sources ship).
- [ ] `publint` clean; `attw --profile esm-only` clean on the `.tgz`.
- [ ] Consumers on the tarball: TS {5.9 (proposed floor), 6.0, 7.0} × {`bundler`, `nodenext`} typecheck, with `skipLibCheck: false`.
- [ ] Core-only fixture **without `react` and `@types/react` installed** typechecks and imports at runtime.
- [ ] React 18 and React 19 fixtures (with matching `@types/react`) typecheck and render (SSR import).
- [ ] Node 22, 24, 26: `import()` and `require()` of both entry points succeed (or are explicitly unsupported per D4).
- [ ] Vite build of a consumer importing each subpath succeeds, and core-only output contains no React.
- [ ] All README/docs snippets compile against the built package (no `paths`).
- [ ] The `instanceof ToolError` identity holds across `<pkg>` and `<pkg>/react` (single module instance).

**Release**
- [ ] `release.yml` refuses: non-`main`/`next` ref; `confirm_version` mismatch; pending changesets; prerelease on `main`; stable on `next`; missing changelog entry; conflicting tag.
- [ ] Only the `stage` job has `id-token: write`; it has no checkout, no install, no cache (verified via zizmor + reading the run log).
- [ ] The integrity checked in `stage` equals the `build` output equals the registry `dist.integrity`.
- [ ] Tag `<pkg>@<v>` at the manifest SHA; immutable release with the `.tgz` + manifest; prerelease flag for `next`.
- [ ] Re-dispatching after success is refused by `plan` ("already published"); *re-run* of `finalize` after success is a no-op (state table row "at SHA / published / assets match").
- [ ] npm package settings: trusted publisher stage-only, tokens disallowed; `npm token list` shows no write tokens.

**Repo**
- [ ] Every `uses:` is a 40-hex SHA with a version comment; repo setting enforces it.
- [ ] Every workflow has `permissions: {}` at top level.
- [ ] zizmor + actionlint required and green.
- [ ] Rulesets exported (`gh api repos/<o>/<r>/rulesets`) and stored in `docs/` as the reference state.

## 5. Test plan: dry runs, adversarial scenarios, rollback

"No creds" = can run without npm/GitHub admin rights, **once the scripts/workflows of the relevant phase exist** (none of them exists today). "Owner" = needs the maintainer's settings/credentials. Keep `plan.mjs`/`finalize.mjs` decision logic as pure functions with fixture inputs (registry responses, tag/release states), so R0/R8 are mostly unit tests.

| ID | Scenario | Expected | Needs |
|---|---|---|---|
| R0 | Run `plan.mjs` with fixtures: `REF=refs/heads/feature`, mismatched/invalid version (quotes, `$()`, newline, leading `-`), pending changeset, prerelease on main, version already on registry, registry 5xx (must **not** count as absent), existing tag | each one exits 1 with a clear message | no creds |
| R0b | `check-changeset.mjs`: feature PR without a changeset (fail), with one (pass), valid version PR (pass), fake version PR bumping to a different version or touching other files (fail) | as stated | no creds |
| R6b | **Compromised build drill:** on a scratch branch, add a step after the tests that edits `dist/index.js` and lets `pack.mjs` regenerate the hash/manifest | pipeline passes (by design); the **local rebuild diff** in the approval checklist flags the change | owner (scratch, reject the stage) |
| R8b | `finalize.mjs` state table with fixtures: absent/absent, absent/draft, tag-at-SHA/no-release, published with matching assets (no-op), published with wrong/missing assets (fail), tag elsewhere (fail), tag created between the check and the publish | as specified in 03 §2 | no creds |
| R1 | Run `pack.mjs` locally; diff the file list; run consumers | matches checklist | no creds |
| R2 | `act`-free dry run: dispatch `release.yml` on a fork of the repo (your own fork has no npm trust) | plan + build pass; `stage` fails OIDC exchange (no trust config) **without** having run any dependency code | no npm creds |
| R3 | zizmor `--pedantic` on all workflows | 0 findings, or documented ignores | no creds |
| R4 | **Fork PR attack:** PR modifies `ci.yml` to `echo $ACTIONS_ID_TOKEN_REQUEST_URL` / attempt `npm stage publish` | no id-token available; token read-only; requires approval to even run | 2nd account |
| R5 | **Branch dispatch attack:** push a branch with a modified `release.yml` that skips checks, then dispatch it | plan refuses the ref. Even with plan removed, env `npm-release` refuses the branch (deployment policy), so no OIDC | owner (env set) |
| R6 | **Artifact substitution:** in a test run, mutate the tarball between build and stage (debug step on a scratch branch with a test-only env) | `stage` fails on digest mismatch | owner (scratch env) |
| R7 | **Staged-but-rejected:** stage a real prerelease `0.1.0-next.0` to `next`, reject it on npm, dispatch again | finalize fails with nothing tagged; the re-dispatch re-stages the same version (documented by npm) | owner |
| R7b | **Lost run with pending stage:** stage, cancel the run before finalize, dispatch again | `stage` fails on the existing stage; runbook: approve-after-hash-check or reject, then continue | owner |
| R8 | **Partial failure:** approve on npm, make finalize fail (cancel it), then *Re-run failed jobs* | tag + release created at the run SHA with the artifact bytes. A re-dispatch is refused by `plan` | owner |
| R8c | **Manual historical repair drill** (03 §4 runbook) on a prerelease: delete nothing, but walk through `npm pack` + `npm audit signatures` + SLSA field read + `gh release create --draft` on a test tag | runbook works end to end; timing noted | owner |
| R9 | **Docs rollback:** dispatch `docs.yml` with `stable_ref` = previous tag | site serves the old stable; `/next/` unchanged; `build-info.json` reflects it | owner (Pages on) |
| R10 | **npm rollback drill:** on a prerelease: `npm dist-tag add <pkg>@<prev> next`, `npm deprecate <pkg>@<bad>` | tag moved, warning shown on install | owner |
| R11 | **Cache poisoning check:** confirm the release path never restores a cache (log shows no cache restore; zizmor `cache-poisoning` clean) | no restore | no creds |
| R12 | **Dependabot vs release age:** a Dependabot PR for a package published < 3 days ago | CI fails on release-age (by design) and passes once aged | no creds |
| R13 | **Settings drift:** `gh api` snapshot of rulesets/environments/actions permissions compared with the stored reference | identical | owner (read) |

What can be verified **without credentials, once its phase is implemented**: R0, R0b, R1, R3, R8b, R11, R12, the whole package checklist, and R2 on a fork. Nothing in this list can be run today, because no build, scripts, workflows or Dependabot config exist yet. Prerequisites to request from the owner later: decisions D1–D5, npm scope ownership, the bootstrap publish (2FA), environment/ruleset creation, Pages enablement, and a second GitHub account (or collaborator) for R4.
