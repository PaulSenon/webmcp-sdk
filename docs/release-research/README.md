# Release & delivery study — webmcp-sdk

Status: **implemented** (2026-11-11) in `.github/workflows/{ci,release}.yml`, `tooling/release/`, `packages/webmcp-sdk` and the repository settings; the maintainer runbook is [`docs/releasing.md`](../releasing.md). Deviations from this study, all deliberate: package `@senon/webmcp-sdk` in `packages/webmcp-sdk` (the owner's existing `@senon` scope); pnpm stays on 10.33 (settings `allowBuilds`, `strictDepBuilds`, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps` in `pnpm-workspace.yaml`); the release jobs use Node 24.22.2 (bundled npm 11.19.1 ≥ 11.15 for `npm stage`); dev typechecks keep `paths` to the sources, and the published shape is checked by `test:package` against the packed tarball; docs site and `docs.yml` deferred until there is a site.

The study text below is unchanged. Observed 2026-11-11. No code, manifest, lockfile, workflow, repository setting or registry state was changed. All YAML/JSON below and in sibling files is *specification*, not an active file.

| File | Content |
|---|---|
| [README.md](README.md) (this file) | Recommendation: one architecture, the key trade-offs, guarantees and limits |
| [01-sources.md](01-sources.md) | State of the art: primary-doc facts + real-repo survey matrix pinned to SHA, with limits |
| [02-threat-model.md](02-threat-model.md) | Compact publication threat model, controls, residual risk |
| [03-workflows-spec.md](03-workflows-spec.md) | Workflows, triggers, permissions, jobs, settings — as snippets |
| [04-inventory-migration.md](04-inventory-migration.md) | Read-only inventory of today, gaps, ordered migration plan, acceptance checklist, adversarial/rollback tests |
| [05-owner-decisions.md](05-owner-decisions.md) | Decisions that are genuinely the owner's, with a recommended default for each |
| `raw/A-security-publishing.md`, `raw/B-repo-survey.md`, `raw/C-tooling.md` | Sub-research notes (GPT-6.1-sol, high), every fact with URL/date/confidence. Evidence base; this synthesis supersedes them where they differ |
| `raw/D-critique.md` | Adversarial review (GPT-6.1-sol, xhigh) of this synthesis: 22 findings, all integrated (03 notes which fix answers which finding) |

---

## 0. Blocking finding first: the package name is not available

`npm view` on 2026-11-11:

| Name | Status |
|---|---|
| `webmcp-sdk` (current `package.json` name, every README import) | **Taken** — `0.5.9`, maintainer `up2itnow5280`, repo `up2itnow0822/webmcp-sdk`, modified 2026-10-07 |
| `@webmcp-sdk/core`, `@webmcp-sdk/react`, `@webmcp-sdk/testing` | **Taken** — scope `@webmcp-sdk` owned by `conanmcn` (repo `ConanMcN/webmcp-sdk`) |
| `@webmcp/core` | Taken (other project) · `webmcp` taken · `webmcp-kit` taken |
| `@paulsenon/webmcp-sdk`, `@webmcp-kit/sdk`, `@webmcp-tools/sdk`, `webmcp-toolkit`, `typed-webmcp` | Not published publicly (registry 404). Scope *ownership* could not be checked without an npm session |

Consequences: (1) the package **must be renamed** before any publish. (2) The README says the project is unpublished, but every snippet imports from `"webmcp-sdk"`. Anyone who installs that name gets a *different, unaffiliated* package: a name-confusion exposure that grows with visibility. (3) A namespace you own (npm user or org scope) is the only real defence against future look-alike names; it also makes trust configuration and ownership audit trivial. **Recommended default: a scope you control** (e.g. an npm org such as `@webmcp-kit` if free, else your user scope `@paulsenon`), package `<scope>/sdk` or `<scope>/webmcp-sdk`. Decision D1 in [05](05-owner-decisions.md). Everything below writes `<pkg>` for that name.

---

## 1. Recommended architecture (one option, justified)

```
/                              private root: pnpm workspace, tooling only, never published
├─ packages/sdk/               the ONLY published package: <pkg>
│   ├─ src/ (index.ts, react/index.ts, …)   exports "." and "./react"
│   ├─ tests/ type-tests/
│   ├─ tsconfig.json  tsconfig.build.json   build = native tsc 7 → dist/*.js + *.d.ts
│   └─ package.json   files:["dist"], ESM-only, react optional peer
├─ apps/docs/                  private: Astro Starlight site, depends on "<pkg>": "workspace:*"
├─ tooling/consumers/          private: fixture projects that install the PACKED tarball
├─ .changeset/                 Changesets 3 config + pending change files
└─ .github/
    ├─ workflows/ci.yml        untrusted-safe PR + main checks (no secrets, no id-token)
    ├─ workflows/release.yml   ONLY workflow trusted by npm; workflow_dispatch from main/next
    ├─ workflows/docs.yml      GitHub Pages deploy; separate identity from npm
    ├─ workflows/repo-hygiene.yml  zizmor/actionlint (can be folded into ci.yml)
    ├─ dependabot.yml  CODEOWNERS
```

### 1.1 Package shape: one package with `./react` subpath (not separate packages)

Kept as today: one package, `exports` `"."` and `"./react"`, `react >=18` optional peer.

- **Why:** the React layer is a thin binding over core state (registry/catalog, error classes). Two packages would mean two versions to keep in lockstep, and if the versions skew, `instanceof ToolError` and registry identity can break across copies. One tarball means one version, one changelog, one trust config, one provenance. Convex Helpers, Better Auth and Zod ship framework/sub-entries as subpaths of one package for the same reason ([01 §B](01-sources.md#b-real-repository-survey-pinned)).
- **Split later only if** React gets its own *runtime* dependencies, its own release cadence, or a second framework binding needs incompatible peers. Changesets supports adding a second package without redesign.
- **Guard:** core must never import from `./react` (types included). A fixture without React and without `@types/react` proves it (see 04 acceptance).

### 1.2 Build: ESM-only, native `tsc` emit, unbundled

- `tsc -p tsconfig.build.json` (TS 7.0.x native): `rootDir: src`, `outDir: dist`, `declaration: true`, `noEmit: false`, excludes tests. One JS file + one `.d.ts` per source module. The module graph is preserved, so `./react` and core import the *same* `dist/index.js`, and no state is duplicated.
- **No bundler at first.** tsdown is the credible bundler (0.23.x, pre-1.0). Its d.ts path on TS 7.0 relies on a CLI fallback that its own README marks deprecated (C §2). tsup's README says it is not actively maintained. A bundler adds churn without adding consumer value for ~1.4k LOC.
- **ESM-only.** Node 20 is EOL (2026-04-30). Node 22.12+, 24 and 26 can load synchronous ESM through `require` (require(esm)). The package targets browsers and bundlers. Dual CJS would add `.d.cts` files and dual-package state hazards for no identified consumer. Revisit only if a real consumer needs CJS.
- `exports`: `{ ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }, "./react": { … } }`. `sideEffects: false` stays as an *audited claim* (no import-time registration).
- The current `tsconfig` `paths` aliases (`webmcp-sdk` → `./src`) are why today's typechecks cannot catch packaging errors. Tests and docs must resolve through the workspace package's `exports` (`workspace:*` link to built `dist`), and release gates must resolve through the **tarball**.

### 1.3 Tests of the real artifact

1. `pnpm --filter <pkg> pack` produces **one** `.tgz`, once per release run. Record its sha512 and `npm` integrity.
2. `publint` and `attw --profile esm-only` run on that file.
3. `tooling/consumers/*` install the tarball (no workspace link, `--ignore-scripts`, `skipLibCheck: false`) across a small matrix: TS {floor (proposed 5.9), 6.0, 7.0} × moduleResolution {`bundler`, `nodenext`}, plus core-only-without-React, React 18 and 19, Node {22, 24, 26} import + `require()`, and one bundler build (Vite).
4. Docs examples: keep the existing idea of `scripts/check-readme.mjs` (extract fenced `ts/tsx` blocks and typecheck them). Make it recursive over `apps/docs/src/content/**/*.md(x)` and README, and resolve `<pkg>` through the package (no `paths`). In the release run, re-check a representative subset against the tarball.
5. The **same bytes** that passed are the bytes published (artifact digest checked in the publish job). Never rebuild or repack in the privileged job.

### 1.4 Versioning and release: Changesets 3 + explicit `workflow_dispatch` + npm staged publishing

| Step | Who/what | Trust |
|---|---|---|
| Contributor PR adds `.changeset/*.md` (package + bump + prose) | anyone, forks included | none; `changeset status` check in CI |
| **Version PR**: `pnpm changeset version` → bumps `package.json`, writes `CHANGELOG.md`, deletes change files | maintainer (locally in v1; optional bot later, D6) | reviewed like any PR, merged through the `main` ruleset |
| **Release run**: Actions → `release.yml` → *Run workflow* on `main` (or `next`), input `confirm_version` | maintainer, explicit | `plan` → `build` (no identity) → `stage` (env `npm-release`, OIDC, uploads tarball only) |
| **Registry approval**: checklist ([03 §4](03-workflows-spec.md#4-runbooks-approval-recovery-rollback)): one pending stage, hash match, **local rebuild + content diff**. Then `npm stage approve` with **2FA** | maintainer | independent of GitHub; npm malware scan must finish first |
| **Finalize**: job waits on env `release-finalize` approval (no runner held), then verifies npm serves the version **with the same integrity**, then creates tag `<pkg>@x.y.z` at the recorded SHA and an **immutable** GitHub Release with the `.tgz` + manifest attached | maintainer approves, workflow acts | `contents: write` only in this job |

Why this and not the alternatives (full comparison in [01 §C](01-sources.md#c-tooling-decisions-evidence)):

- **Changesets over release-please or semantic-release.** The bump and changelog come from reviewed files, not from parsing commit titles, so the result is deterministic and explicit and contributors don't need commit conventions. Changesets has native prerelease (`pre enter next`) and snapshot modes, and skips versions already on the registry. The actors with the same version-PR model (AI SDK, Effect, Better Auth, Expo, Convex Helpers) are on Changesets. release-please is a good alternative only if conventional squash titles are already enforced. It doesn't publish to npm, so you would write that part anyway.
- **`workflow_dispatch` over push-to-main auto-publish or tag-push.** Publishing is irreversible (versions are immutable, unpublish is very limited). A credential that can push to `main` or push a tag must not be able to publish alone. Zod adopted dispatch-only for this exact threat. Tag-push triggers make the tag the *cause*, but the tag should be the *record* of a verified publish. They also make tag-creation rights publication rights.
- **Staged publishing (npm `stage publish`, GA May 2026) with a stage-only trusted publisher.** For a **solo maintainer**, GitHub environment reviewers add almost nothing ("prevent self-review" needs a second human). The npm-side 2FA approval, on the actual bytes, after npm's malware scan, works regardless of what happened in GitHub. A stolen OIDC token (the TanStack May-2026 path: cache poisoning, then token read from runner memory) can stage, but **cannot publish**. Convex Helpers and Zod use this pattern today.
- Not chosen: auto canary/snapshot publishing to npm (D7: optional, later, `next`/`snapshot` dist-tags only); pkg.pr.new (third-party app; optional later).

**Prereleases:** long-lived `next` branch in Changesets pre mode → same `release.yml` dispatched on `next` → dist-tag `next` (derived from the version, never from a free-text input). **dist-tag moves / rollback** (`latest` → previous good version) are done **by the maintainer's CLI with 2FA**, not by CI. OIDC dist-tag permission exists (GA 2026-09-30) but stays off. That is one less authority to protect, and the operation is rare.

**Idempotence / partial failure** (detail in [03 §4](03-workflows-spec.md#4-runbooks-approval-recovery-rollback)): `release.yml` only releases the version at the head of `main`/`next`, and refuses one that is already on npm. Failures are repaired by *Re-run failed jobs* in the same run (artifact kept 30 days). `finalize` handles each tag/draft/release state explicitly. Repairing older runs is a **manual runbook** using registry bytes and an audited provenance verifier (`npm audit signatures`), not automation. The review showed that automatic historical recovery means verifying Sigstore bundles, handling tag/draft races, and hitting a `GITHUB_TOKEN` limitation when workflow files differ. That is too much trusted code for a rare event. Conflicting tags are never moved. A version is never re-packed under the same number; a bad release gets deprecate + a new patch. A rejected stage can be re-staged under the same version.

### 1.5 Docs/site CD: separate workflow, separate identity, GitHub Pages by default

- `docs.yml` deploys static Starlight output with `actions/deploy-pages` (environment `github-pages`, `pages: write` + `id-token: write` scoped to the Pages audience). It cannot publish to npm: npm trust names `release.yml` only, and `docs.yml` never gets that environment.
- **Stable docs come from the latest release tag. Next docs (`/next/`) come from `main`, with an "unreleased" banner.** Both are built in one job, because a Pages deploy replaces the whole site. Before the first release, `/` = main with the banner. The footer shows version + SHA.
- **Fork PRs:** `ci.yml` builds the site under `pull_request` (read-only token, no secrets) and uploads it as a downloadable artifact. Nothing is deployed for forks. Live previews are opt-in via Netlify's OSS plan (fork deploys need approval; can build without sensitive vars). That is D3, not a default.
- **Rollback:** dispatch `docs.yml` with `ref: <previous tag>`. Docs are independent of npm: a docs fix doesn't need a package release.
- Cost: GitHub Pages is free for public repos. No new account, no hosting token.

### 1.6 Supply-chain baseline (minimum robust)

1. **One publish identity, OIDC only.** npm trusted publisher = `<owner>/webmcp-sdk` + `release.yml` + environment `npm-release`, **stage-only**. After the first OIDC publish succeeds: package setting "require 2FA and disallow tokens", no npm tokens anywhere. Account 2FA uses WebAuthn/passkey.
2. **The privileged job runs no repository dependencies and no lifecycle scripts.** The `stage` job does not check out the repo or install dependencies. It sets `cache-mode: none` and `package-manager-cache: false`, downloads one artifact, checks its sha512, and validates the manifest (including `publishConfig`). Then it runs `npm stage publish --ignore-scripts pkg.tgz` with Node 26's bundled npm 11.20 (≥ 11.15 for `stage`). What it still trusts: the hosted runner image, two pinned GitHub actions, Node/npm.
3. **Workflows:** top-level `permissions: {}`, per-job grants; all actions pinned to full SHA with a version comment, enforced by repo setting `sha_pinning_required`; no `pull_request_target`/`workflow_run`; untrusted `${{ }}` contexts only via `env:`; `persist-credentials: false`; zizmor + actionlint required on PRs; CODEOWNERS on `.github/` (useful once there is a second maintainer).
4. **Dependencies:** exact `packageManager` pnpm pin; `pnpm install --frozen-lockfile`; `pnpm-workspace.yaml` with explicit `minimumReleaseAge` (proposed 3 days, strict), `strictDepBuilds`/`allowBuilds` allowlist (expected ~empty; Playwright browsers are installed explicitly, not by a lifecycle hook), `blockExoticSubdeps: true`, `trustPolicy: no-downgrade`. **Dependabot** (native, no app; version updates for `npm` + `github-actions`; grouped; `cooldown` 7 days; no auto-merge of release tooling or majors).
5. **Repository settings:** `main` ruleset (PR required with 0 approvals while solo, required checks, no force-push or deletion, **no routine bypass**, because a bypass also skips the checks); tag ruleset blocking update/delete of `<pkg>@*`; immutable releases on; fork-PR workflow approval for *all outside contributors*; secret scanning + push protection; private vulnerability reporting; `can_approve_pull_request_reviews: false` (already).
6. **Evidence:** npm provenance (automatic with trusted publishing, public repo); immutable GitHub Release with the exact `.tgz` and a `release-manifest.json` (name, version, SHA, integrity, run URL). **Not** in the baseline: SBOM (one runtime dependency: low value), extra `actions/attest` on the tarball (redundant with npm provenance + release attestation), Scorecard (useful later as a drift signal, D9).

### 1.7 What this guarantees — and what it does not

**Holds if settings are applied as specified:**
- No version becomes installable without a human 2FA approval on npm of those exact staged bytes.
- No CI path other than `release.yml` → `stage` in env `npm-release` (on `main`/`next`) can even stage. A leaked GitHub PAT/push credential, a fork PR, a poisoned cache, or a malicious dependency in `ci`/`build` cannot publish: none of them coexists with an `id-token`. At worst they cause a **stage**, which you notice and reject.
- The staged/published tarball is byte-identical to the artifact that run's `build` job produced (sha512 checked in `stage` and `finalize`). Tag/release point at the run's SHA, and npm provenance records the same SHA and workflow.
- **With the local rebuild diff in the approval checklist**, the published *contents* equal what the reviewed commit builds on your machine. That is the one check a compromised CI build cannot forge.

**Does not hold / residual:**
- "Tested" is not proven by the pipeline: a compromised build step (malicious dev dependency) can alter bytes *after* the tests and regenerate its own hash, manifest and summary. Only the local rebuild diff catches that. Skip it, and the guarantee shrinks to "came from this repo's release workflow".
- **Approval fatigue.** If you approve without the checklist, staging is theatre. The npm malware scan is a heuristic.
- A malicious change that passes review (or your own compromised machine with a valid 2FA session) still ships. Your npm account and laptop remain the root of trust.
- A compromised *runtime* dependency (`@standard-schema/spec`) affects consumers regardless of your pipeline.
- GitHub/npm platform compromise, or bugs in the actions you pin, are out of scope. SHA pinning freezes code but doesn't vet it.
- Provenance proves *where/how* it was built, not that it's safe. Few consumers verify it.
- Settings drift (someone re-enables tokens, removes the ruleset) isn't caught automatically unless you add Scorecard or a periodic check (D9).

## 2. Essential trade-offs (summary)

| Choice | Picked | Rejected / deferred | Why |
|---|---|---|---|
| Package split | 1 package, `./react` subpath | `core` + `react` packages | shared identity, single version; split path stays open |
| Module format | ESM-only | dual ESM/CJS | require(esm) on all supported Node LTS; no CJS consumer identified |
| Build | native `tsc` | tsdown/tsup/bunchee | TS7 d.ts support in bundlers is in flux; nothing to bundle |
| Versioning | Changesets 3 | release-please, semantic-release, nx | reviewed, deterministic intent files; prerelease/snapshot; peers use it |
| Trigger | `workflow_dispatch` + npm stage 2FA | push-to-main auto, tag-push | push/tag rights ≠ publish rights; solo-maintainer-effective gate |
| npm auth | OIDC trusted publishing, stage-only, tokens disallowed | NPM_TOKEN, direct OIDC publish | no long-lived secret; stolen OIDC can only stage |
| dist-tag changes | manual CLI with 2FA | OIDC dist-tag permission | rare; keep CI authority minimal |
| Docs host | GitHub Pages | Netlify (previews), Cloudflare Workers, Vercel | zero account/token/cost; previews optional |
| Fork previews | artifact only | live previews | no secrets near fork code |
| Dep updates | Dependabot | Renovate | native, no app; cooldown + grouping suffice for one package |
| Merge queue | no | — | requires org-owned repo; pointless at this PR volume |
| SBOM/extra attestations/Scorecard | later/optional | — | low marginal value now; documented when it would pay |

## 3. Coordination with the runtime thread

Order matters more than layout ([04 §3](04-inventory-migration.md#3-ordered-migration-plan)). The review showed that packaging correctness is more urgent than the folder move. So **phase 2a** makes the current root package publishable *in place*: build, compiled exports, tarball tests, Changesets, no `paths`. **Phase 2b** is the move into `packages/sdk/` + `apps/docs/`: a single rename-only PR, run when the runtime thread is merged and idle, never interleaved. Phase 0 (account decisions) and phase 1 (CI + settings on today's flat layout) can start now without touching runtime files. The release pipeline (phase 3) can ship from either layout. If the docs site is postponed, 2b can be postponed with it.
