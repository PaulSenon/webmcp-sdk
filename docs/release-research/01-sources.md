# 01 — Sources and current state of the art (observed 2026-11-11)

Method: the primary docs (npm, GitHub, pnpm, tool repos/registries) and the real repositories were read on 2026-11-11. Repository code is pinned to the default-branch SHA fetched that day. Confidence: **V** = verified in a primary source, **I** = engineering inference, **U** = unverified. Full per-fact citations are in `raw/A-*.md` (security/publishing), `raw/B-*.md` (repo survey, 211 pinned links) and `raw/C-*.md` (tooling). I re-checked the npm trusted-publisher page and the TanStack post-mortem myself.

## A. Platform facts the design depends on

### npm

| Fact | Conf. | Source |
|---|---|---|
| Trusted publishing (OIDC) GA since 2025-07-31; needs npm ≥ 11.5.1, Node ≥ 22.14; GitHub-hosted runners only (no self-hosted) | V | [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers/), [GA changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/) |
| GitHub trust fields: owner, repo, **workflow filename**, optional **environment**. Case-sensitive. **No branch/ref field**: refs are constrained via environment deployment policies | V / I | same |
| Up to 10 trusted publishers per package, additive (multiple-config GA 2026-09-03). Permissions are separate per config: `stage publish` (always), direct `publish` (opt-in for configs created after 2026-09-03), `dist-tag` (opt-in, GA 2026-09-30, npm ≥ 11.21 / 12.2) | V | [trusted-publishers](https://docs.npmjs.com/trusted-publishers/), [multi-config](https://github.blog/changelog/2026-09-03-multiple-trusted-publishing-configurations-for-npm/), [dist-tag OIDC](https://github.blog/changelog/2026-09-30-opt-in-dist-tag-permissions-for-npm-trusted-publishing/) |
| A new config must publish successfully within **2 days** or it expires (delete + recreate). npm rejects OIDC publishes from `pull_request_target` and `issue_comment` | V | [expiry changelog 2026-10-02](https://github.blog/changelog/2026-10-02-unvalidated-npm-trusted-publishing-configurations-now-expire/) |
| **Staged publishing** GA (May 2026, npm ≥ 11.15): CI runs `npm stage publish <tgz>`; a maintainer approves with 2FA, and only then is the version installable. Approval waits for npm's malware scan. `pnpm stage` exists since pnpm 11.3 | V | [staged publishing GA](https://github.blog/changelog/2026-05-29-staged-publishing-and-new-install-time-controls-for-npm/), [npm stage CLI](https://docs.npmjs.com/cli/v12/commands/npm-stage/), [pnpm 11.3](https://pnpm.io/blog/releases/11.3) |
| Provenance is automatic with trusted publishing from GitHub/GitLab for a public package from a public repo | V | [trusted-publishers](https://docs.npmjs.com/trusted-publishers/) |
| `npm stage publish` **can create a new package**, and a rejected stage **can be re-staged under the same version**. Stage accepts `--tag`, `--access`, `--ignore-scripts`, `--json` (a `Publish` subclass in npm 11.20) | V | [npm stage (v11 docs, edited 2026-09-29)](https://docs.npmjs.com/cli/v11/commands/npm-stage/), [npm 11.20 source](https://github.com/npm/cli/blob/v11.20.0/lib/commands/stage/publish.js) (via review D11) |
| **Configuring a trusted publisher *before* the package exists: undocumented.** Hence the bootstrap with a placeholder version (04 phase 3) | **U** | [trusted-publishers](https://docs.npmjs.com/trusted-publishers/) |
| `dist.integrity` = `sha512-` + base64(sha512(compressed tarball as supplied)), so a pnpm-packed tgz's own hash is comparable. Attestation URL comes from `dist.attestations.url`; the response holds a publish attestation + SLSA v1 provenance (`buildDefinition.externalParameters.workflow`, `resolvedDependencies[].digest.gitCommit`, subject PURL + **hex** sha512) | V | [libnpmpublish 11.20](https://github.com/npm/cli/blob/v11.20.0/workspaces/libnpmpublish/lib/publish.js), [provenance.js](https://github.com/npm/cli/blob/v11.20.0/workspaces/libnpmpublish/lib/provenance.js) (via review) |
| Classic tokens permanently revoked 2025-12-09; granular write tokens max 90 days, 2FA by default; direct granular-token publishing deprecated for removal **January 2027** | V | [classic revocation](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/), [access tokens](https://docs.npmjs.com/about-access-tokens/) |
| Package setting "Require 2FA and disallow tokens" overrides any bypass-2FA token | V | [2FA settings](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/) |
| `name@version` is immutable, even after unpublish. Unpublish only within 72 h with no dependents, or later under strict conditions. Recovery = deprecate + dist-tag + new version | V | [unpublish policy](https://docs.npmjs.com/policies/unpublish/), [dist-tag](https://docs.npmjs.com/cli/v12/commands/npm-dist-tag/) |
| Bundled npm (nodejs.org/dist/index.json): Node **26.13.0 → npm 11.20.0**, 24.22.2 → 11.19.1, 22.23.4 → 10.9.9 | V | [nodejs dist index](https://nodejs.org/dist/index.json) |
| npm `latest` dist-tag = 12.2.2 | V | `npm view npm dist-tags` |

Design consequence: the publish job uses **Node 26 with its bundled npm 11.20** (≥ 11.15 for `stage`, ≥ 11.5.1 for OIDC). Nothing gets installed in the privileged job. We don't need OIDC dist-tag (≥ 11.21) because dist-tags are moved manually.

### GitHub

| Fact | Conf. | Source |
|---|---|---|
| Environments on public Free repos: required reviewers (≤ 6, one approval suffices), prevent-self-review, wait timer, deployment branch/tag policies. Admins may bypass unless disabled | V | [deployments & environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) |
| OIDC `sub` with environment = `repo:OWNER/REPO:environment:NAME`. Repos created after 2026-07-15 use the `OWNER@ID/REPO@ID` form | V | [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) |
| Rulesets for branches and tags on public Free repos; creation/update/deletion are separate rules. **Merge queue requires an org-owned public repo** (this repo is personal) | V | [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) |
| Whether `GITHUB_TOKEN` (GitHub Actions) can be a tag-ruleset *bypass actor* for **creation**: no authoritative answer found. GitHub Apps are the documented route | **U** | [creating rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) |
| Immutable releases GA 2025-10-28: assets **and the tag** are locked once published. Upload assets while still a draft. Verify with `gh release verify` | V | [immutable releases GA](https://github.blog/changelog/2025-10-28-immutable-releases-are-now-generally-available/) |
| Repo-level `sha_pinning_required` and allowed-actions policy | V | [REST actions permissions](https://docs.github.com/en/rest/actions/permissions), [changelog 2025-08-15](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/) |
| Caches: PR caches are scoped to the merge ref. Low-trust triggers get read-only default-branch cache. `cache-mode: none` disables cache access for a job | V | [dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) |
| Artifacts: immutable, digest exposed on upload. `download-artifact` **v8 fails on digest mismatch by default** (older versions warned). That digest covers the artifact ZIP, so we still compare the tarball's sha512 ourselves. With a single `artifact-ids` value, files extract directly into `path` | V | [download-artifact v8.0.2 source](https://github.com/actions/download-artifact/blob/v8.0.2/src/download-artifact.ts), [upload-artifact](https://github.com/actions/upload-artifact) |
| `cache-mode: none` is a real job/workflow key. Creating a release whose target commit has `.github/workflows/` different from the default branch needs workflow authority, which `GITHUB_TOKEN` cannot have. Draft releases don't materialize their tag. A PR-only ruleset bypass also skips required checks | V | [caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), [releases REST](https://docs.github.com/en/rest/releases/releases), [cli#11589](https://github.com/cli/cli/issues/11589), [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) (via review) |
| Events created by `GITHUB_TOKEN` do not trigger new workflow runs (except `workflow_dispatch`/`repository_dispatch`) | V | [triggering a workflow](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow) |
| GitHub Pages: no native PR previews; deploy with `actions/deploy-pages` (`pages: write`, `id-token: write`) | V | [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) |

### pnpm / dependency tooling

| Fact | Conf. | Source |
|---|---|---|
| Registry dist-tags: pnpm `latest` = **v11 line** (11.28.x). v12 ships under `latest-12`. Local machine runs 10.33.3 | V | [pnpm 12 announcement](https://pnpm.io/blog/releases/12.0), `npm view pnpm dist-tags` |
| v11: `allowBuilds` replaces `onlyBuiltDependencies`; `strictDepBuilds` default true; `minimumReleaseAge` default 1440 min (non-strict unless set explicitly); `blockExoticSubdeps` default true; Node 22+ | V | [pnpm 11.0](https://pnpm.io/blog/releases/11.0), [dependency resolution](https://pnpm.io/settings/dependency-resolution) |
| `trustPolicy: no-downgrade` rejects a version with weaker publish evidence than earlier ones (metadata, not code safety) | V | [settings](https://pnpm.io/settings/dependency-resolution) |
| `pnpm pack` rewrites `workspace:`/`catalog:` protocols. Publishing that tarball with npm is therefore safe; running `npm publish` on the raw workspace dir is not | V / I | [workspaces](https://pnpm.io/workspaces), [catalogs](https://pnpm.io/catalogs) |
| Corepack not bundled from Node 25. Use `pnpm/action-setup` (v6.1.1, 2026-11-03) reading `packageManager` | V | [Node 25 corepack](https://nodejs.org/docs/latest-v25.x/api/corepack.html), [action-setup](https://github.com/pnpm/action-setup/releases/tag/v6.1.1) |
| Dependabot supports pnpm 11/12 ([2026-10-20](https://github.blog/changelog/2026-10-20-dependabot-now-supports-npm-12-pnpm-11-and-12-and-bun-1-4/)); `cooldown` (default/major/minor/patch days), `groups`, `github-actions` ecosystem (updates SHA pins) | V | [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) |
| zizmor v1.32.0 (2026-11-02), audits incl. `dangerous-triggers`, `template-injection`, `cache-poisoning`, `excessive-permissions`, `unpinned-uses`, `artipacked`, `use-trusted-publishing` | V | [zizmor release](https://github.com/zizmorcore/zizmor/releases/tag/v1.32.0), [audits](https://docs.zizmor.sh/audits/) |

Latest action releases observed (`gh api …/releases/latest`): checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.1, upload-artifact v7.0.2, download-artifact v8.0.2, upload-pages-artifact v5.0.0, deploy-pages v5.0.1, changesets/action v2.1.2, zizmor-action v0.8.1, actionlint v1.7.12, dependency-review-action v5.0.0, scorecard-action v2.5.0. **Resolve each to a commit SHA at implementation time** (`gh api repos/<o>/<r>/git/ref/tags/<tag>`, dereferencing annotated tags). The SHA is the pin; the tag is a comment.

## B. Real-repository survey (pinned)

Full analysis, line-level links and snippets: `raw/B-repo-survey.md`. Identity notes: `sst/opencode` → **anomalyco/opencode** (default branch `dev`); `get-convex/*` → **convex/***; "Alchemy" = **alchemy-run/alchemy** (Effect-based; `sam-goodwin/alchemy` redirects to `alchemy-run/alchemy-async`); **"Dotrun" could not be identified** as a JS/TS project (only `canonical/dotrun`, Python) and was skipped rather than guessed. Vercel is represented by **vercel/ai** and **vercel/turborepo**; sigstore-js is a security-oriented contrast.

| Repo @ SHA (commit date) | Version tool | Trigger | npm auth | Pattern worth noting | Weakness noted |
|---|---|---|---|---|---|
| [pingdotgg/t3code @5da53f8](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml) (2026-11-11) | custom | tag / schedule / dispatch | OIDC | publisher validates artifact ID + digest; OIDC only in publish job | some mutable action tags; app, not library |
| [anomalyco/opencode @611cee9](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/release.yml) (2026-11-11) | custom | dev/beta push; dispatch stable | OIDC | build/sign/publish split, environments on credential jobs, SHA pins | continuous channels on push |
| [convex/convex-helpers @8b87b6c](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/release.yml) (2026-11-11) | Changesets | version commit / dispatch (SHA ancestry-checked) | **OIDC stage-only** | stage job: sparse checkout, no deps, no cache, `--ignore-scripts`; human 2FA on npm; Renovate 14-day age; `.npmrc min-release-age=7` | tag created at *staged*, not published |
| [convex/convex-js @078e8fa](https://github.com/convex/convex-js/tree/078e8fabf067e3a13e7f76079773a36b871d091d/.github/workflows) | not visible | — | unknown | public mirror; publishing not observable | `npm i` (not frozen) in CI |
| [expo/expo @11d6c38](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/publish-packages.yml) (2026-11-11) | Changesets + expotools | push / dispatch / schedule | OIDC, envs | separate stable/canary environments; canary still dry-run | very large surface; not a template |
| [alchemy-run/alchemy @01792ec](https://github.com/alchemy-run/alchemy/tree/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows) (2026-11-11) | custom lockstep | dispatch | OIDC | dispatch-only | workflow-wide `id-token`; beta channel publisher defaults to `latest` |
| [Effect-TS/effect @f9f5f9d](https://github.com/Effect-TS/effect/tree/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows) (2026-11-11) | Changesets + promote | main push; scheduled promotion | OIDC | publish to staging tag, then promote to `latest` | `id-token` in a job that also installs/builds |
| [colinhacks/zod @19c40d2](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml) (2026-11-06) | manual manifest | **dispatch only** | **OIDC stage-only** | two gates (env + npm 2FA); finish job verifies registry before tagging; comment ties design to push-credential theft | stage job installs/builds/tests *with* `id-token`; checkout tag-pinned |
| [better-auth/better-auth @1a79da5](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/release.yml) (2026-11-11) | Changesets | push / dispatch | OIDC + token for dist-tag helper | `permissions: {}` default; notes bound to approved SHA; tsdown ESM-only + publint + attw enforced in CI | residual token path |
| [vercel/ai @70e45d5](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml) (2026-11-11) | Changesets | main / `release-v*` push / dispatch | OIDC | maintenance branches, tsdown ESM | one-job version+publish |
| [vercel/turborepo @af729ab](https://github.com/vercel/turborepo/tree/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows) (2026-11-10) | custom | dispatch | OIDC | native binary matrix | docs install `turbo@canary` (non-reproducible) |
| [sigstore/sigstore-js @3154029](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/release.yml) (2026-11-05) | Changesets | main push | OIDC | SHA pins, Scorecard | auto-publish on push |
| [Effect-TS/effect-smol @3a1128c](https://github.com/Effect-TS/effect-smol/tree/3a1128c7684e04d34d9f541f77adaac38a513056) (2026-07-14) | Changesets | historical | NPM_TOKEN | — | archived per README; **do not copy** |

What the survey supports:
1. **Changesets is the common versioning layer** for JS libraries (AI SDK, Effect, Better Auth, Expo, Convex Helpers, sigstore-js). Larger projects add custom release orchestration on top.
2. **OIDC is the norm.** Remaining token paths sit in auxiliary jobs (dist-tag helpers, older repos), which is why we keep dist-tags manual.
3. **Two small-library projects with a concrete threat rationale (Zod, Convex Helpers) converged on dispatch/version-commit + npm stage-only + human 2FA.** Convex Helpers additionally isolates the stage job from dependency execution. We copy that isolation, which Zod lacks.
4. **Popular ≠ hardened.** Several repos grant `id-token` to jobs that run the whole dependency tree, keep mutable action tags, or have dist-tag defaults that contradict the channel. We copy none of these.

## C. Tooling decisions — evidence

| Topic | Evidence (observed 2026-11-11) | Decision |
|---|---|---|
| Changesets | CLI 3.0.3 (2026-09-14), needs pnpm ≥ 10, Node `^22.11 \|\| ^24 \|\| >=26`. action v2.1.2 has `version` / `pack` / `publish` sub-actions. CLI has `changeset pack --out-dir` and `publish --from-pack-dir` | Use the CLI for `version` and `changeset status`. Publish the tarball with `npm stage publish` directly: one less abstraction in the privileged job, and stage mode isn't documented in the action |
| release-please | 17.11.2, action v5.0.0. No npm publishing; needs conventional commits | Alternative only |
| semantic-release | 25.0.9; fully automatic on push | Rejected (no human-reviewed version step) |
| TypeScript | 7.0.2 (2026-07-08), native `tsc`, no legacy compiler API until 7.1 | Emit with native `tsc`. Tools that embed the old API (api-extractor → TS 6.0.3, TypeDoc ≤ 6.0, attw embeds TS 5.6) run *on emitted `.d.ts`* or in an isolated workspace |
| tsdown | 0.23.7 pre-1.0. rolldown-plugin-dts 0.30.1 TS7.0 path deprecated | Deferred |
| tsup | 9.0.0, README "not actively maintained" | Rejected |
| publint / attw | 0.3.25 / 0.18.5 (supports `--profile esm-only` on a `.tgz`) | Adopted, run on the packed tarball |
| Node LTS | 20 EOL 2026-04-30. 22 maintenance → 2027-04-30. 24 maintenance → 2028-04-30. 26 active → 2029-04-30 | CI tooling on Node 26. Consumer tests 22/24/26 |
| Starlight | 0.42.10 / Astro 7.4.10. Static, Pagefind search. Versioning via separate builds | Adopted. Twoslash/TypeDoc deferred (their TS peers are ≤ 6) |
| Docusaurus / VitePress / Fumadocs | 3.10.2 (native versioning) / 1.6.4 stable, 2.0 alpha / 16.18.4 (Next, Twoslash on TS 7.1-beta) | Not needed for one maintained major |
| Hosting | Pages free, no previews. Netlify OSS plan: fork previews need approval, can build without sensitive vars. Cloudflare Pages: no fork previews; Workers is now the recommended path. Vercel Hobby: non-commercial; Fork Protection | Pages default; Netlify optional for previews |

## D. Incidents that shaped the controls

| Incident | Vector | Control in this design | Source |
|---|---|---|---|
| tj-actions/changed-files (2025-03-14), reviewdog (2025-03-11) | retargeted mutable action tags, including transitive ones | full-SHA pins + `sha_pinning_required`; few actions; zizmor `unpinned-uses`/`impostor-commit` | [StepSecurity](https://www.stepsecurity.io/blog/harden-runner-detection-tj-actions-changed-files-action-is-compromised) |
| Nx "s1ngularity" (2025-08-26) | workflow script injection → npm token stolen | no npm token; untrusted contexts via `env:` only; zizmor `template-injection` | [Nx post-mortem](https://nx.dev/blog/s1ngularity-postmortem) |
| chalk/debug (2025-09-08), axios (2026-03-31) | maintainer phishing / account takeover | WebAuthn 2FA; tokens disallowed; consumers: `minimumReleaseAge` | [axios post-mortem](https://github.com/axios/axios/issues/10636) |
| Shai-Hulud 1 & 2 (2025-09, 2025-11) | malicious install scripts stealing tokens, self-replicating | `strictDepBuilds`/`allowBuilds`; release age; no tokens to steal | [GitHub response](https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/) |
| **TanStack (2026-05-11)** | `pull_request_target` fork code → poisoned pnpm cache → release job restored it → OIDC token read from runner memory → direct publish | no `pull_request_target`; no cache in privileged jobs; `id-token` only in a job that runs no deps; **stage-only** so a stolen token cannot publish | [TanStack post-mortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) (re-read 2026-11-11) |
| Red Hat "Miasma" (2026-06) | upstream CI compromise, published through legitimate OIDC | provenance alone is insufficient; human stage approval + minimal privileged job | [Microsoft](https://www.microsoft.com/en-us/security/blog/2026/06/02/preinstall-persistence-inside-red-hat-npm-miasma-credential-stealing-campaign/) |

## E. Limits of this research

- Settings described for other repos (environment reviewers, npm stage-only trust) are what their **workflow source declares**; their account settings weren't observable.
- Nothing was executed end-to-end: no OIDC publish, no stage, no Pages deploy, no tarball consumer test. Every operational claim is a gate to prove in the dry-run plan ([04](04-inventory-migration.md)).
- Living docs change. Prices and limits (Netlify credits, Vercel Hobby, Pages) are as observed and must be re-checked when choosing.
- Unresolved, to be proven at bootstrap: trust configuration before the package exists (§A, **U**); exact `npm stage publish --json` output fields; whether npm notifies maintainers of new stages; `GITHUB_TOKEN` as a tag-ruleset bypass actor (**U**); whether `pnpm/action-setup` enforces the `packageManager` hash. The adversarial review (`raw/D-critique.md`) verified several load-bearing facts against versioned source (npm 11.20, download-artifact 8.0.2, setup-node 7.1.0, zizmor-action 0.8.1, pnpm 11.28.6, Changesets 3.0.3).
