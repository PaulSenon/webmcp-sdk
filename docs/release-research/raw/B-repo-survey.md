# B — Repository release / CI / docs deployment survey

Observed **2026-11-11**. Every code link below is pinned to the default-branch commit returned by `gh api repos/<owner>/<repo>/commits/<default_branch>`; commit dates are UTC, not release dates. Repository metadata, complete recursive file trees (none truncated), all top-level workflow YAMLs, selected manifests and release helpers were read through GitHub API / raw GitHub without executing repository code. No clones or installs were needed.

## Identity resolution and scope

- T3 Code: **pingdotgg/t3code**, verified by GitHub API.
- OpenCode: **sst/opencode redirects to anomalyco/opencode**; default branch is **dev**, not main.
- Convex: all three **get-convex/** names redirect to **convex/**.
- Alchemy: **sam-goodwin/alchemy redirects to alchemy-run/alchemy-async** (Infrastructure as TypeScript, v1 homepage); **alchemy-run/alchemy** is a distinct current Effect-based project (Infrastructure as Effects). This survey selects the latter, not the Web3 SDK.
- Effect: canonical **Effect-TS/effect** is current. **effect-smol** is a historical comparison: its pinned README says development moved, although the API returned `archived: false`. Do not infer current release practice from its old workflow.
- “Dotrun”: searches for `dotrun`, `dot-run`, and JS/TS variants found [canonical/dotrun](https://github.com/canonical/dotrun), (GitHub API reports Python), but no confident identification of the intended JS/TS project. **Skipped**, without substituting dotenv or an unrelated project.
- Vercel: selected **AI SDK + Turborepo** rather than Next.js; these expose both ordinary multi-package JS publishing and native-platform package coordination. Sigstore JS supplies one security-oriented contrast.

“OIDC” describes the checked-in credential path, not independently verified npm trust settings. Environment names do not prove required reviewers are configured. “Not found” is bounded to inspected source. Pinning describes release entry workflows unless otherwise stated.

## Summary matrix

| Repo (canonical in sections) | Default SHA / commit date UTC | Version tool | Trigger | npm auth | Provenance | Action pinning | Docs host | Notes |
|---|---|---|---|---|---|---|---|---|
| pingdotgg/t3code | [5da53f87d9fe](https://github.com/pingdotgg/t3code/commit/5da53f87d9feba9717bca516215aa3dedd0a694a) / 2026-11-11T11:55:08Z | custom | tag / schedule / dispatch | OIDC | explicit | mixed | Markdown; Vercel marketing | CLI launcher + Electron; nightly/preview |
| anomalyco/opencode | [611cee9d4b66](https://github.com/anomalyco/opencode/commit/611cee9d4b667b459f19ca0cbf6e76d8647535fb) / 2026-11-11T11:43:07Z | custom | dev/beta push; dispatch stable | OIDC | explicit + build attestation | SHA | Cloudflare | isolated build/sign/publish |
| convex/convex-js | [078e8fabf067](https://github.com/convex/convex-js/commit/078e8fabf067e3a13e7f76079773a36b871d091d) / 2026-11-09T21:15:09Z | not visible | public CI only | unknown | unknown | SHA | docs in backend repo | client export/mirror repository |
| convex/convex-backend | [d26741f4bfc4](https://github.com/convex/convex-backend/commit/d26741f4bfc42bf175f409e9bf1cba6a8e052c29) / 2026-11-10T22:45:17Z | custom images; npm unknown | push / dispatch / reusable | npm unknown; AWS OIDC | Docker disabled | SHA | Netlify | Rust + pnpm/Turbo |
| convex/convex-helpers | [8b87b6c00013](https://github.com/convex/convex-helpers/commit/8b87b6c0001313f6b81cc31006a09c7827bc431d) / 2026-11-11T00:24:53Z | Changesets + custom staging | version commit / dispatch | OIDC stage-only (declared) | explicit | SHA | no standalone site found | manual npm 2FA approval |
| expo/expo | [11d6c38ebfe6](https://github.com/expo/expo/commit/11d6c38ebfe6344cf7da54fff82d562b068ed576) / 2026-11-11T11:23:35Z | Changesets + expotools | branch push / dispatch / schedule | OIDC | explicit env | SHA | Cloudflare Pages | scheduled canary currently dry-run |
| alchemy-run/alchemy | [01792ec321e2](https://github.com/alchemy-run/alchemy/commit/01792ec321e2a51b9662ea73f7f1d8e17524736a) / 2026-11-11T06:31:49Z | custom lockstep | dispatch | OIDC intent | not explicit in publish call | SHA | Cloudflare | beta default; publisher uses latest |
| Effect-TS/effect | [f9f5f9de9431](https://github.com/Effect-TS/effect/commit/f9f5f9de9431a6ac47b249a443ba999c67c35ac2) / 2026-11-11T10:36:32Z | Changesets + promote | main push; promotion schedule | OIDC | manifest | SHA | separate website; deploy via promote | staging then latest |
| Effect-TS/effect-smol | [3a1128c7684e](https://github.com/Effect-TS/effect-smol/commit/3a1128c7684e04d34d9f541f77adaac38a513056) / 2026-07-14T17:35:13Z | Changesets (historical) | main push (historical) | NPM_TOKEN present | manifest | tags | moved to effect | README says archived; API flag false |
| colinhacks/zod | [19c40d207228](https://github.com/colinhacks/zod/commit/19c40d2072288b4cafec851e9d056a72a88e5973) / 2026-11-06T15:57:39Z | manual manifest + custom stage | dispatch only | OIDC stage-only (declared) | explicit | mixed | Vercel | two human gates; zshy |
| better-auth/better-auth | [1a79da50672c](https://github.com/better-auth/better-auth/commit/1a79da50672c8a7ccea89c93b11b25aea86262be) / 2026-11-11T08:29:39Z | Changesets + release tooling | branch push / dispatch / reusable | OIDC release; token dist-tag helper | no explicit flag found in release | SHA | Next/Fumadocs; host unverified | approved notes bound to SHA |
| vercel/ai | [70e45d587849](https://github.com/vercel/ai/commit/70e45d5878494be4b66e325187f865951025059e) / 2026-11-11T00:56:00Z | Changesets | main/release-v* path push / dispatch | OIDC | manifest | SHA | Vercel | tsdown; ESM core; maintenance branches |
| vercel/turborepo | [af729aba8697](https://github.com/vercel/turborepo/commit/af729aba869736a9f03a0192d438cca35f4cc02b) / 2026-11-10T23:54:39Z | custom turbo-releaser | dispatch; schedule commented out | OIDC | explicit | SHA | Vercel | native matrix; custom staging branch |
| sigstore/sigstore-js | [3154029799fe](https://github.com/sigstore/sigstore-js/commit/3154029799fe44e6a037fc634e175abe091521b3) / 2026-11-05T16:33:56Z | Changesets | main push | OIDC intent | manifest | SHA | package READMEs | npm workspaces; Scorecard |

## Per-repository findings

### T3 Code
- **Layout/build:** pnpm 12 + Vite+ (vp), server/web/desktop/mobile apps and internal provider packages. Server t3 is ESM, bundled with vp pack; an application distribution rather than a public binding library. [package.json L75](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/package.json#L75) [apps/server/package.json L20](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/apps/server/package.json#L20)
- **Release:** custom stable/nightly/preview; tag pushes, half-hour schedule and dispatch. Stable serializes separately from nightly. npm launcher publishes after release assets exist, preventing missing-download installs. [.github/workflows/release.yml L3](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml#L3) [.github/workflows/release.yml L1046](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml#L1046)
- **Boundary:** publisher validates artifact ID/version and rejects digest mismatch; OIDC only in publishing job, no npm token. Reduces artifact substitution and credential exposure. Mutable action tags remain in this entry workflow. [.github/workflows/release.yml L1075](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml#L1075) [.github/workflows/release.yml L62](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml#L62)
- **Docs:** Markdown operations docs; Astro marketing has Vercel deployment code. Hosted web app also uses Vercel. Dedicated versioned docs/fork-docs deployment not identified. [apps/marketing/package.json L9](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/apps/marketing/package.json#L9) [apps/marketing/vercel.ts L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/apps/marketing/vercel.ts#L1)
- **Dependencies:** allowBuilds map and age exceptions, but no explicit numeric minimumReleaseAge in workspace file. No own Renovate/Dependabot config discovered (vendored .repos excluded). [pnpm-workspace.yaml L12](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/pnpm-workspace.yaml#L12)

[.github/workflows/release.yml L1101](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release.yml#L1101)
```yaml
      - name: Publish the npm launcher
        env:
          DIST_TAG: ${{ needs.preflight.outputs.cli_dist_tag }}
        run: |
          # The ./ keeps npm from reading the path as a GitHub owner/repo spec.
          if ! npm publish --access public --tag "$DIST_TAG" --provenance ./npm-packages/t3.tgz; then
            echo "::error::npm publish failed. Make sure package t3 has a trusted publisher registered for .github/workflows/release.yml (see docs/operations/release.md)." >&2
            exit 1
          fi
```

### OpenCode
- **Layout/build:** Bun 1.4.4 workspaces + Turbo checks; separate CLI, SDK, protocol, AI/UI packages. SDK ESM, custom Bun build/pack and verify:package; exact d.ts generator not established. [package.json L8](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/package.json#L8) [packages/sdk/package.json L24](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/packages/sdk/package.json#L24)
- **Release:** custom plan; dev/beta push continuous channels; dispatch bump/version creates stable releases. Build, sign, publish jobs separated; release environments on credential jobs. [.github/workflows/release.yml L17](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/release.yml#L17) [.github/workflows/release.yml L624](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/release.yml#L624)
- **Artifact defense:** verifies GitHub attestations against signer workflow; allowlists names/version; rejects extra publishConfig and unexpected lifecycle scripts; clean npm config; tarball publish with ignore-scripts/provenance. Platform dependencies must resolve before wrappers publish. Addresses substituted artifacts, registry redirection, credential execution and registry propagation delay. [.github/release/publish-npm.sh L20](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/release/publish-npm.sh#L20) [.github/release/publish-npm.sh L58](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/release/publish-npm.sh#L58)
- **Auth:** id-token write, no npm token in publish workflow; SHA-pinned actions. AWS secrets elsewhere serve signing/deployment, not evidence of npm token use. [.github/workflows/release.yml L624](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/release.yml#L624)
- **Docs:** custom Vite/Bun site including textjs, Cloudflare output; separated build/deploy, dev/production branches. Public-fork preview/versioned docs not established. Bun policy, no pnpm; no own dependency bot found. [services/site/package.json L13](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/services/site/package.json#L13) [.github/workflows/deploy-site.yml L63](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/deploy-site.yml#L63)

[.github/workflows/release.yml L624](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/release.yml#L624)
```yaml
  publish-npm:
    needs: [plan, sign-macos, sign-windows, publish-attestations, verify]
    if: ${{ !cancelled() && !failure() && needs.plan.outputs.cli == 'true' }}
    runs-on: ubuntu-24.04
    environment: ${{ needs.plan.outputs.dry_run != 'true' && 'release' || '' }}
    permissions:
      contents: read
      id-token: write
      attestations: read
    env: *env
```

### Convex JS
- **Layout:** one public convex package; React/Next/server/auth/browser/values are subpath exports, not independent React packages. Dual CJS/ESM with distinct public/internal declaration conditions. [package.json L17](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/package.json#L17)
- **Build:** Python orchestrates esbuild compilation and tsc declarations (public/internal × ESM/CJS), browser/CLI bundles. [scripts/build.py L66](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/scripts/build.py#L66) [scripts/build.cjs L17](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/scripts/build.cjs#L17)
- **CI:** sole public workflow is main push/PR; SHA-pinned actions, npm i, ESM/import checks, lint. No explicit workflow permissions/concurrency. npm i allows resolution drift compared with npm ci. [.github/workflows/test-and-lint.yml L35](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/.github/workflows/test-and-lint.yml#L35)
- **Release:** npm trigger/version bot/auth/provenance/prerelease policy not visible. Manifest prepack runs version check/build/preparation. Docs live in backend repo; no bot/pnpm config here. No publint/attw invocation found. [package.json L196](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/package.json#L196)

[.github/workflows/test-and-lint.yml L35](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/.github/workflows/test-and-lint.yml#L35)
```yaml
      - run: npm i

      - run: npm run test-esm

      - run: npm run lint
```

### Convex backend
- **Layout:** Rust backend plus pnpm 11/Turbo under npm-packages; same dual-export client, separate dashboard/docs/integrations. [npm-packages/package.json L5](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/package.json#L5) [npm-packages/convex/package.json L17](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/convex/package.json#L17)
- **Release:** custom self-hosted image workflows; branch push/dispatch composes reusable build/test/promote workflows, AWS OIDC and self-hosted AWS runners. Public npm version/publish orchestration unknown. [.github/workflows/release_self_hosted_images.yml L3](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/release_self_hosted_images.yml#L3) [.github/workflows/release_local_backend.yml L24](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/release_local_backend.yml#L24)
- **Weakness:** backend/dashboard Docker provenance explicitly false; no implication about npm tarballs. SHA-pinned actions help protect action identity. [.github/workflows/release_local_backend.yml L63](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/release_local_backend.yml#L63)
- **Docs:** Docusaurus/Netlify; filtered locked install + Turbo dependencies before docs build. Fork admission/version archive not established. mise self-update weakens toolchain determinism. [npm-packages/docs/package.json L23](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/docs/package.json#L23) [npm-packages/docs/netlify.toml L7](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/docs/netlify.toml#L7)
- **Dependencies:** minimumReleaseAge 10080 minutes (7 days), exceptions, allowBuilds; no own bot config discovered. [npm-packages/pnpm-workspace.yaml L160](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/pnpm-workspace.yaml#L160) [npm-packages/pnpm-workspace.yaml L468](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/npm-packages/pnpm-workspace.yaml#L468)

[.github/workflows/release_local_backend.yml L63](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/release_local_backend.yml#L63)
```yaml
          provenance: false
          build-args: |
            VERGEN_GIT_SHA=${{ github.sha }}
```

### Convex Helpers
- **Layout/build:** npm project; one ESM helpers package with React/server subpaths; tsc JS/types, esbuild CJS CLI. [package.json L150](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/package.json#L150) [package.json L9](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/package.json#L9)
- **Version/release:** Changesets + version workflow; release detects version commits on main or accepts validated full dispatch SHA constrained to selected-ref ancestry. Stable latest; prerelease identifier chooses tag. Pending changesets block release. [.changeset/config.json L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.changeset/config.json#L1) [.github/workflows/version.yml L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/version.yml#L1) [.github/workflows/release.yml L75](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/release.yml#L75)
- **Reusable boundary:** plan/build/stage/tag jobs have separate permissions; tested tarball uploaded once. Stage installs no deps, restores no cache, uses artifact ID/OIDC/provenance/ignore-scripts. Maintainer must approve on npm with 2FA. Tag means staged, not published. Stage-only npm trust is an external requirement stated in source. [.github/workflows/release.yml L130](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/release.yml#L130) [.github/workflows/release.yml L172](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/release.yml#L172)
- **Fork metadata:** pull_request_target workflow explicitly checks out base-only; no PR code/install. This protects comment credentials if boundary is preserved. [.github/workflows/changeset-status.yml L5](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/changeset-status.yml#L5)
- **Dependencies/docs:** Renovate 14-day age, grouped routine/automerge; later devDependencies rule also enables automerge, so dev majors are not necessarily manual. No standalone docs deploy found. [renovate.json L5](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/renovate.json#L5) [renovate.json L17](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/renovate.json#L17)

[.github/workflows/release.yml L137](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/release.yml#L137)
```yaml
    # Only upload the tarball: no dependencies or package scripts run with OIDC.
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: ${{ fromJSON(needs.plan.outputs.release).sha }}
          persist-credentials: false
          sparse-checkout: .nvmrc
          sparse-checkout-cone-mode: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
```

### Expo
- **Layout/build:** pnpm workspace + Turbo, many independent expo-* / @expo/* native and JS packages; Expo package delegates build to internal expo-build, emits build/Expo.js + Expo.d.ts with expo-source conditions. This is not a simple Node dual-export library. Exact internal transpiler not traced. [pnpm-workspace.yaml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/pnpm-workspace.yaml#L1) [packages/expo/package.json L214](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/packages/expo/package.json#L214) [packages/expo/package.json L74](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/packages/expo/package.json#L74)
- **Release:** Changesets plus expotools; branch policy decides stable version PR/publish. Push, dispatch and nightly; canary job exists but scheduled publication is explicitly **dry-run** while validated. Stable/canary use separate npm-publish environments, id-token and NPM_CONFIG_PROVENANCE; no write npm token in publisher. Read-only npm owner-validation token is unrelated. [.github/workflows/publish-packages.yml L3](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/publish-packages.yml#L3) [.github/workflows/publish-packages.yml L342](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/publish-packages.yml#L342) [.github/workflows/publish-packages.yml L30](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/publish-packages.yml#L30)
- **Docs:** Next static export to Cloudflare Pages; SDK beta/promote workflows and versioned docs scripts. PR preview opt-in via preview label. Uses ordinary pull_request + Cloudflare/bot secrets, so do not promise public fork deploys (secrets unavailable by default). [docs/package.json L20](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/docs/package.json#L20) [.github/workflows/docs.yml L119](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/docs.yml#L119) [.github/workflows/docs-pr.yml L77](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/docs-pr.yml#L77)
- **Dependencies:** 1-day age gate with substantial first-party/native exceptions; allowBuilds/strictDepBuilds/blockExoticSubdeps. Weekly grouped Dependabot for SHA-pinned actions. Protects install-time execution and reduces fresh-package exposure, subject to exceptions. [pnpm-workspace.yaml L23](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/pnpm-workspace.yaml#L23) [pnpm-workspace.yaml L17](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/pnpm-workspace.yaml#L17) [.github/dependabot.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/dependabot.yml#L1)
- **Tradeoff:** platform build runners/toolchains and postpublish synchronization are justified by SDK/native compatibility; disproportionate template defaults for one TS package.

[.github/workflows/publish-packages.yml L305](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/publish-packages.yml#L305)
```yaml
    environment: npm-publish-canary
    concurrency:
      group: publish-packages-canary-${{ github.ref_name }}
      cancel-in-progress: false
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

### Alchemy (Effect-based current repo)
- **Layout/build:** pnpm 12 + Bun tooling, core alchemy plus separate @alchemy.run/* providers; ESM exports with Bun TS-source condition, JS/types under lib. Custom shared package builder invokes native tsrs with tsc fallback. [package.json L97](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/package.json#L97) [packages/alchemy/package.json L51](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/packages/alchemy/package.json#L51) [scripts/package-build.ts L114](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/scripts/package-build.ts#L114)
- **Release:** manual custom lockstep release, beta default; accepts alpha/rc/semver and ad hoc 0.0.0-name specs. Build/pack/commit-tag then publish downloaded tarballs. All release actions SHA-pinned. [.github/workflows/release.yml L4](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/release.yml#L4) [.github/workflows/release.yml L71](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/release.yml#L71)
- **Surprising tag behavior:** actual publisher documents and uses default **latest**, even for release specs named beta/rc; workflow channel metadata does not equal npm tag. No explicit provenance flag in this publish call or inspected core publishConfig. OIDC is declared by workflow/comment, npm trust configuration unverified. [scripts/release/publish.ts L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/scripts/release/publish.ts#L1) [scripts/release/publish.ts L102](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/scripts/release/publish.ts#L102)
- **Weakness:** workflow-level contents write/id-token write are inherited by the dependency-install/build job. Splitting tarballs alone does not isolate npm identity from build execution. Build commit/tag precedes npm, so interrupted publication needs idempotent recovery. [.github/workflows/release.yml L23](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/release.yml#L23) [.github/workflows/release.yml L80](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/release.yml#L80)
- **Docs:** Astro on Cloudflare through Alchemy; production only release-commit/explicit prod, ordinary main deploys main stage. Only same-repo labeled PRs preview; separate test Cloudflare account and cleanup allowlist. Deploy step still executes repository code with a cloud token. [website/package.json L17](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/website/package.json#L17) [.github/workflows/website.yml L73](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/website.yml#L73) [.github/workflows/website.yml L160](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/website.yml#L160)
- **Dependencies:** allowBuilds, age exception list but no numeric minimumReleaseAge in inspected workspace; no own dependency bot config found. [pnpm-workspace.yaml L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/pnpm-workspace.yaml#L1)

[.github/workflows/release.yml L23](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/release.yml#L23)
```yaml
permissions:
  contents: write
  id-token: write

```

### Effect TS (current)
- **Layout/build:** pnpm 11; core effect has many subpaths, separate atom React/Solid/Vue, platform and SQL adapters. Core is now ESM-only, tsc project build/declarations followed by Babel pure-call annotation. Do not copy historical Effect v3 dual-build assumptions. [packages/effect/package.json L135](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/packages/effect/package.json#L135) [packages/effect/package.json L87](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/packages/effect/package.json#L87)
- **Release:** Changesets main-push Version PR/publish, fixed version group, snapshot tag-commit template; publisher builds and pushes to **staging**. Separate npm-promote schedule/workflow_run/manual path waits for full package availability before latest and website deployment. Avoids partial version graphs. [.changeset/config.json L15](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.changeset/config.json#L15) [package.json L35](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/package.json#L35) [.github/workflows/npm-promote.yml L2](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/npm-promote.yml#L2)
- **Auth:** OIDC, manifest provenance true; separate npm-promote environment and pause kill switch; PAT used for release PR automation, not npm authentication. Release job still installs dependencies with id-token permission. All external actions in release entry SHA-pinned. [packages/effect/package.json L89](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/packages/effect/package.json#L89) [.github/workflows/release.yml L10](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/release.yml#L10) [.github/workflows/npm-promote.yml L28](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/npm-promote.yml#L28)
- **Docs:** promotion workflow mentions/delegates website deployment; public site framework/hosting and fork policy live outside inspected repo, so unknown here. Snapshot workflow uses pkg-pr-new (commit package previews, not a documentation host). [.github/workflows/release.yml L46](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/release.yml#L46) [.github/workflows/snapshot.yml L49](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/snapshot.yml#L49)
- **Dependencies:** allowBuilds mostly false, no numeric age setting or bot config found in inspected tree. [pnpm-workspace.yaml L20](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/pnpm-workspace.yaml#L20)

[.github/workflows/release.yml L44](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/release.yml#L44)
```yaml
      # Packages are published under the `staging` dist-tag. The npm promote
      # workflow moves `latest` once npm serves every package, then deploys the
      # website.
```

### Effect-smol (historical; not current recommendation)
- Pinned README says archived/read-only and V4 moved to Effect-TS/effect; API archived flag false. Last default commit July 14, 2026. [README.md L1](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/README.md#L1)
- pnpm 10, Changesets, ESM core plus separate platform/SQL/atom binding packages, manifest provenance and onlyBuiltDependencies policy. [package.json L4](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/package.json#L4) [package.json L98](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/package.json#L98) [packages/effect/package.json L66](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/packages/effect/package.json#L66)
- Historical main-push release grants id-token **and** explicitly injects NPM_TOKEN; therefore **not tokenless**, regardless of OIDC setup comment. Mutable checkout/Changesets action tags. No current docs host or bot config established. [.github/workflows/release.yml L47](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/.github/workflows/release.yml#L47)
- Snapshot workflow exists; it is historical configuration, not proof that the abandoned repository still publishes. This is a concrete reason to inspect migration notices before copying popular repositories.

[.github/workflows/release.yml L42](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/.github/workflows/release.yml#L42)
```yaml
        env:
          # Use a personal access token instead of the one that GitHub generates
          # automatically to ensure workflows get triggered on the changesets
          # release branch.
          GITHUB_TOKEN: ${{ secrets.CHANGESET_GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

```

### Zod
- **Layout/build:** Nub 0.8.3 workspaces (not pnpm at this SHA), zshy/tsc-based compilation; dual ESM/CJS with .d.cts type surface and version/mini/core subpaths; separate @zod/mini lockstep package. [package.json L4](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/package.json#L4) [packages/zod/package.json L38](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/packages/zod/package.json#L38) [packages/zod/package.json L39](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/packages/zod/package.json#L39)
- **Release:** dispatch only, manifest versions/custom stage scripts, tests on Node/OS matrix, npm stage-only publisher behind npm environment; finish job waits on release-approval then checks registry before tags/GitHub/JSR. Source states required reviewers and stage-only external trust; settings not independently verified. No automatic version PR, tag-push release or canary automation observed. [.github/workflows/release.yml L12](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L12) [.github/workflows/release.yml L91](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L91) [.github/workflows/release.yml L196](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L196)
- **Threat justification:** comments explicitly tie dispatch-only + two gates to a claimed stolen-push-credential incident. This survey verifies the comment exists, **not the historical incident**. Credential that can push must not automatically publish; npm 2FA approval remains separate from workflow identity. [.github/workflows/release.yml L5](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L5)
- **Limits:** staging job runs install/build/tests with id-token available; stronger than unattended publishing for human approval, weaker than isolated credential-only upload. Checkout uses mutable v7; setup-nub pinned SHA. npm CLI installed from floating major. [.github/workflows/release.yml L114](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L114) [.github/workflows/release.yml L55](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L55)
- **Docs/deps:** Next/Fumadocs on Vercel with separate docs-v3; Vercel installer URL pinned to SHA, frozen workspace install. Fork admission policy unknown. attw dependency exists, but dependency alone does not prove enforcement; resolution tests explicitly run. No dependency bot config found. [packages/docs/package.json L9](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/packages/docs/package.json#L9) [packages/docs/vercel.json L3](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/packages/docs/vercel.json#L3) [.github/workflows/release.yml L61](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L61)

[.github/workflows/release.yml L91](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L91)
```yaml
    environment: npm
    # this job only builds and stages; the wait for the approval is `finish`, which holds no runner until it is approved
    timeout-minutes: 60
    permissions:
      contents: read
      id-token: write
    outputs:
```

### Better Auth
- **Layout/build:** pnpm 11/Turbo; core better-auth has React/Svelte/Solid/etc subpaths; adapters/Expo/plugins also separate packages. tsdown ESM-only, .d.mts, dts build true. Strict publint + attw esm-only run in CI, not merely listed as dependencies. [packages/better-auth/tsdown.config.ts L4](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/packages/better-auth/tsdown.config.ts#L4) [packages/better-auth/package.json L32](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/packages/better-auth/package.json#L32) [.github/workflows/ci.yml L91](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/ci.yml#L91)
- **Release:** Changesets with main/next/maintenance push, dispatch snapshots and reusable workflow. Release environment, default permissions empty, job contents read + id-token write; scoped GitHub App credentials for PR/version automation. Release notes are bound to approved PR head/release SHA; unconsumed changesets rejected. Stops reruns on newer commits silently publishing an unreviewed version. [.github/workflows/release.yml L3](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/release.yml#L3) [.github/workflows/release.yml L213](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/release.yml#L213) [.github/workflows/release.yml L222](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/release.yml#L222)
- **Channels:** main/latest vs next/pre identifiers; snapshot refuses latest/next/beta/rc collisions, builds and publishes with explicit tag/no git tag. npm OIDC path has no write npm secret, but no explicit provenance setting in inspected release/core manifest. Separate manual **npm-dist-tag workflow still uses NPM_TOKEN**, no environment declared; do not call the repository entirely tokenless. [.github/workflows/release.yml L22](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/release.yml#L22) [.github/workflows/npm-dist-tag.yml L44](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/npm-dist-tag.yml#L44)
- **Docs/previews:** Next/Fumadocs, version sync scripts; host not proven by checked-in docs package. preview.yml publishes packages through pkg-pr-new on PRs; that is not docs hosting. Fork jobs choose GitHub-hosted runner, internal jobs use own runner. Docs fork/version archive policy unverified. [docs/package.json L8](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/docs/package.json#L8) [.github/workflows/preview.yml L41](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/preview.yml#L41)
- **Dependencies:** allowBuilds, 1-day age with exceptions; Dependabot 7-day cooldown (majors 5), grouped minor/patch and Actions; Renovate weekly/nonmajor grouping also present, potentially overlapping ownership. Both presence/config recorded, not proof both bots run. [pnpm-workspace.yaml L116](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/pnpm-workspace.yaml#L116) [.github/dependabot.yml L14](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/dependabot.yml#L14) [.github/renovate.json5 L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/renovate.json5#L1)
- SHA pins and zizmor/actionlint workflows are strengths; install/build in OIDC job and legacy token helper remain boundaries to consider.

[.github/workflows/npm-dist-tag.yml L40](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/npm-dist-tag.yml#L40)
```yaml
        env:
          PACKAGE: ${{ inputs.package }}
          VERSION: ${{ inputs.version }}
          TAG: ${{ inputs.tag }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Vercel AI SDK
- **Layout/build:** pnpm 12/Turbo, ai core and independent @ai-sdk/* providers/React bindings. At this SHA core is ESM-only with .js/.d.ts export surface, tsdown config shared from workspace tooling. Shared config enables declaration generation and source maps. Root publint task exists; package-specific enforcement not exhaustively traced. [tools/tsdown-config/index.mts L9](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/tools/tsdown-config/index.mts#L9) [package.json L77](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/package.json#L77) [packages/ai/package.json L40](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/packages/ai/package.json#L40) [packages/ai/tsdown.config.ts L1](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/packages/ai/tsdown.config.ts#L1)
- **Version/release:** Changesets; main/release-v* pushes only when changeset/workflow paths change, plus dispatch. Branch-scoped noncancelling concurrency; npm-release environment, OIDC, provenance manifests, pinned actions. Version PR uses GitHub API commitMode; retry logic restores original checkout only for PR preparation, avoiding a second partial publish. [.github/workflows/release.yml L8](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml#L8) [.github/workflows/release.yml L31](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml#L31) [.github/workflows/release.yml L63](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml#L63) [packages/ai/package.json L94](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/packages/ai/package.json#L94)
- **Prereleases:** documented Changesets beta cycle on main, release-v maintenance branches with ai-vN dist-tags. This is a procedure, not a claim main is currently beta (core version is stable 7.0.169). [contributing/pre-release-cycle.md L9](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/contributing/pre-release-cycle.md#L9) [packages/ai/package.json L3](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/packages/ai/package.json#L3)
- **Docs:** Next/Geistdocs/Fumadocs Vercel configuration; explicit v5/v6 hostname redirects to version paths. Fork preview gating is external host policy, unknown here. [apps/docs/package.json L5](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/apps/docs/package.json#L5) [apps/docs/vercel.json L7](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/apps/docs/vercel.json#L7)
- **Dependencies:** 3-day install age, allowBuilds and first-party exceptions; Dependabot 3-day cooldown with separate prod/dev groups and maintenance-branch entries. Avoids one undifferentiated dependency PR stream. [pnpm-workspace.yaml L19](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/pnpm-workspace.yaml#L19) [.github/dependabot.yml L38](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/dependabot.yml#L38)
- **Tradeoff:** single release job combines install/build, PR-write scopes and OIDC, so identity scope is broader than the tested-tarball upload model.

[.github/workflows/release.yml L24](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml#L24)
```yaml
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    # do not attempt running in forks
    if: github.repository_owner == 'vercel'
    environment: npm-release
    steps:
```

### Vercel Turborepo
- **Layout/build:** pnpm 12 plus Rust/Cargo native CLI, separate JS tooling and native platform npm packages. JS tooling uses tsdown (create-turbo explicitly CJS, dts false); library release uses native matrix/artifact packages. Do not generalize one module format/d.ts strategy across these products. [package.json L31](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/package.json#L31) [packages/create-turbo/tsdown.config.ts L1](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/packages/create-turbo/tsdown.config.ts#L1) [.github/workflows/turborepo-library-release.yml L244](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-library-release.yml#L244)
- **Release:** custom turbo-releaser, manifest/version.txt driven; dispatch with canary/semver options, staging branch acts as lock, tag created only after npm success. Cron shown in source is **commented out**, so no active scheduled release should be claimed. Separate manual library workflow publishes @turbo/repository canary and platform packages. [.github/workflows/turborepo-release.yml L36](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-release.yml#L36) [.github/workflows/turborepo-release.yml L5](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-release.yml#L5) [.github/workflows/turborepo-library-release.yml L267](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-library-release.yml#L267)
- **Auth/provenance:** publisher id-token, no npm secret seen; explicit provenance env/flags. Custom helper checks npm metadata for provenance attestation, stronger than merely requesting it. Native tests/artifact coordination justify custom tooling. [.github/workflows/turborepo-library-release.yml L172](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-library-release.yml#L172) [packages/turbo-releaser/src/npm.ts L189](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/packages/turbo-releaser/src/npm.ts#L189)
- **Docs:** Next/Geistdocs/Fumadocs on Vercel. Install command adds **turbo@canary** after frozen install; this intentionally exercises latest Turbo but weakens reproducibility for a small library docs template. Fork-preview/version archive policy not proven. [apps/docs/package.json L3](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/apps/docs/package.json#L3) [apps/docs/vercel.json L2](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/apps/docs/vercel.json#L2)
- **Dependencies/quality:** 2-day age and allowBuilds; no bot config found. attw dependency in internal turbo-utils does not prove release enforcement. [pnpm-workspace.yaml L10](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/pnpm-workspace.yaml#L10) [packages/turbo-utils/package.json L29](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/packages/turbo-utils/package.json#L29)

[.github/workflows/turborepo-library-release.yml L170](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-library-release.yml#L170)
```yaml
    permissions:
      contents: write
      id-token: write # Required for npm Trusted Publishing using OIDC
    env:
      NPM_CONFIG_PROVENANCE: "true"
    needs: [build]
```

### Sigstore JS (security-oriented contrast)
- **Layout/build:** npm workspaces (not pnpm), separate bundle/core/sign/verify/tuf modules, tsc project builds. Inspected sign/core manifests are conventional CJS main dist/index.js + dist/index.d.ts, not dual conditional exports. [package.json L7](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/package.json#L7) [packages/sign/package.json L5](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/packages/sign/package.json#L5) [package.json L8](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/package.json#L8)
- **Release:** Changesets main-push Version PR/publish with branch concurrency; contents-read default, write/PR/id-token scopes at release job. Node 24 npm registry setup, npm ci, SHA-pinned Changesets action; no NPM_TOKEN in workflow. OIDC-compatible publishing intent, provenance true in module manifest. No environment gate or explicit prerelease/snapshot flow found in entry workflow. [.github/workflows/release.yml L1](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/release.yml#L1) [packages/sign/package.json L26](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/packages/sign/package.json#L26)
- **Security:** Scorecard workflow alongside CI/compatibility/conformance/smoke tests. Still runs npm ci/build in same OIDC/write-capable release job: “security project” does not imply strongest privilege separation. [.github/workflows/scorecard.yml L1](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/scorecard.yml#L1) [.github/workflows/release.yml L33](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/release.yml#L33)
- **Dependencies/docs:** weekly Dependabot prod/dev groups and Actions updates, no configured cooldown found. Package READMEs are homepage targets; no separate docs deployment found in tree. pnpm allowBuilds/age N/A. No publint/attw invocation found in inspected manifest/workflows. [.github/dependabot.yml L10](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/dependabot.yml#L10) [packages/sign/package.json L24](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/packages/sign/package.json#L24)

[.github/workflows/release.yml L17](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/release.yml#L17)
```yaml
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
```

## CI security / operational inventory

The following is a mechanical inventory of the fetched top-level workflow YAMLs, not a vulnerability verdict. Local/composite actions and external reusable workflows can add caches or credentials. “Cache” below means an explicit cache action or cache input visible in these YAMLs; no cache entry does not prove uncached installs.

| Repo | Workflow permissions / privileged events | Concurrency / cache evidence |
|---|---|---|
| pingdotgg/t3code | permissions in 25/25 workflows; pull_request_target: [.github/workflows/desktop-macos-preview-publish.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/desktop-macos-preview-publish.yml#L1), [.github/workflows/mobile-eas-preview-fork.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/mobile-eas-preview-fork.yml#L1) | concurrency 19: [.github/workflows/agent-context-budget.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/agent-context-budget.yml#L1), [.github/workflows/ci.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/ci.yml#L1); cache 4: [.github/workflows/ci.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/ci.yml#L1), [.github/workflows/release-desktop.yml L1](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/release-desktop.yml#L1) |
| anomalyco/opencode | permissions in 18/19 workflows; pull_request_target: [.github/workflows/triage-contributor.yml L1](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/triage-contributor.yml#L1), [.github/workflows/triage-pr-standards.yml L1](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/triage-pr-standards.yml#L1) | concurrency 12: [.github/workflows/bot-nix-hashes.yml L1](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/bot-nix-hashes.yml#L1), [.github/workflows/check-bot-scope.yml L1](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/check-bot-scope.yml#L1); cache 1: [.github/workflows/check-test.yml L1](https://github.com/anomalyco/opencode/blob/611cee9d4b667b459f19ca0cbf6e76d8647535fb/.github/workflows/check-test.yml#L1) |
| convex/convex-js | permissions in 0/1 workflows; pull_request_target: none | concurrency 1: [.github/workflows/test-and-lint.yml L1](https://github.com/convex/convex-js/blob/078e8fabf067e3a13e7f76079773a36b871d091d/.github/workflows/test-and-lint.yml#L1); cache 0: none explicit |
| convex/convex-backend | permissions in 5/11 workflows; pull_request_target: none | concurrency 2: [.github/workflows/build_local_backend.yml L1](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/build_local_backend.yml#L1), [.github/workflows/prettier.yml L1](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/prettier.yml#L1); cache 3: [.github/workflows/build_local_backend.yml L1](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/build_local_backend.yml#L1), [.github/workflows/precompile.yml L1](https://github.com/convex/convex-backend/blob/d26741f4bfc42bf175f409e9bf1cba6a8e052c29/.github/workflows/precompile.yml#L1) |
| convex/convex-helpers | permissions in 6/6 workflows; pull_request_target: [.github/workflows/changeset-status.yml L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/changeset-status.yml#L1) | concurrency 5: [.github/workflows/changeset-status.yml L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/changeset-status.yml#L1), [.github/workflows/lint-workflows.yml L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/lint-workflows.yml#L1); cache 1: [.github/workflows/test.yml L1](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/test.yml#L1) |
| expo/expo | permissions in 23/57 workflows; pull_request_target: [.github/workflows/codemention.yaml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/codemention.yaml#L1), [.github/workflows/expo-code-review.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/expo-code-review.yml#L1) | concurrency 47: [.github/workflows/android-instrumentation-tests.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/android-instrumentation-tests.yml#L1), [.github/workflows/android-unit-tests.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/android-unit-tests.yml#L1); cache 3: [.github/workflows/changesets-precompile-android.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/changesets-precompile-android.yml#L1), [.github/workflows/cli.yml L1](https://github.com/expo/expo/blob/11d6c38ebfe6344cf7da54fff82d562b068ed576/.github/workflows/cli.yml#L1) |
| alchemy-run/alchemy | permissions in 7/7 workflows; pull_request_target: none | concurrency 7: [.github/workflows/check.yml L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/check.yml#L1), [.github/workflows/cloudflare-tools.yml L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/cloudflare-tools.yml#L1); cache 3: [.github/workflows/check.yml L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/check.yml#L1), [.github/workflows/cloudflare-tools.yml L1](https://github.com/alchemy-run/alchemy/blob/01792ec321e2a51b9662ea73f7f1d8e17524736a/.github/workflows/cloudflare-tools.yml#L1) |
| Effect-TS/effect | permissions in 11/11 workflows; pull_request_target: [.github/workflows/release-queue.yml L1](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/release-queue.yml#L1) | concurrency 7: [.github/workflows/ai-codegen.yml L1](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/ai-codegen.yml#L1), [.github/workflows/bundle-comment.yml L1](https://github.com/Effect-TS/effect/blob/f9f5f9de9431a6ac47b249a443ba999c67c35ac2/.github/workflows/bundle-comment.yml#L1); cache 0: none explicit |
| Effect-TS/effect-smol | permissions in 5/5 workflows; pull_request_target: none | concurrency 5: [.github/workflows/ai-codegen.yml L1](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/.github/workflows/ai-codegen.yml#L1), [.github/workflows/bundle-comment.yml L1](https://github.com/Effect-TS/effect-smol/blob/3a1128c7684e04d34d9f541f77adaac38a513056/.github/workflows/bundle-comment.yml#L1); cache 0: none explicit |
| colinhacks/zod | permissions in 7/8 workflows; pull_request_target: none | concurrency 2: [.github/workflows/iso-4217.yml L1](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/iso-4217.yml#L1), [.github/workflows/release.yml L1](https://github.com/colinhacks/zod/blob/19c40d2072288b4cafec851e9d056a72a88e5973/.github/workflows/release.yml#L1); cache 0: none explicit |
| better-auth/better-auth | permissions in 20/20 workflows; pull_request_target: [.github/workflows/auto-label.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/auto-label.yml#L1), [.github/workflows/auto-retarget.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/auto-retarget.yml#L1) | concurrency 11: [.github/workflows/auto-changeset.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/auto-changeset.yml#L1), [.github/workflows/backport.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/backport.yml#L1); cache 4: [.github/workflows/ci.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/ci.yml#L1), [.github/workflows/demo.yml L1](https://github.com/better-auth/better-auth/blob/1a79da50672c8a7ccea89c93b11b25aea86262be/.github/workflows/demo.yml#L1) |
| vercel/ai | permissions in 12/12 workflows; pull_request_target: none | concurrency 2: [.github/workflows/reconcile-merge-labels.yml L1](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/reconcile-merge-labels.yml#L1), [.github/workflows/release.yml L1](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/release.yml#L1); cache 1: [.github/workflows/ci.yml L1](https://github.com/vercel/ai/blob/70e45d5878494be4b66e325187f865951025059e/.github/workflows/ci.yml#L1) |
| vercel/turborepo | permissions in 12/12 workflows; pull_request_target: none | concurrency 4: [.github/workflows/lsp.yml L1](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/lsp.yml#L1), [.github/workflows/pr-clean-caches.yml L1](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/pr-clean-caches.yml#L1); cache 1: [.github/workflows/turborepo-test.yml L1](https://github.com/vercel/turborepo/blob/af729aba869736a9f03a0192d438cca35f4cc02b/.github/workflows/turborepo-test.yml#L1) |
| sigstore/sigstore-js | permissions in 9/9 workflows; pull_request_target: none | concurrency 1: [.github/workflows/release.yml L1](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/release.yml#L1); cache 1: [.github/workflows/ci.yml L1](https://github.com/sigstore/sigstore-js/blob/3154029799fe44e6a037fc634e175abe091521b3/.github/workflows/ci.yml#L1) |

For target-event workflows, metadata-only operations or base-only checkouts can be appropriate. The existence of pull_request_target is not evidence of PR-code execution. T3's desktop preview consumer explicitly says never to check out the PR in workflow_run; Convex Helpers' changeset status states no PR execution/install. These are specific defenses against fork PRs obtaining privileged execution, not blanket endorsements of every other target workflow. [.github/workflows/desktop-macos-preview-publish.yml L241](https://github.com/pingdotgg/t3code/blob/5da53f87d9feba9717bca516215aa3dedd0a694a/.github/workflows/desktop-macos-preview-publish.yml#L241) [.github/workflows/changeset-status.yml L5](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.github/workflows/changeset-status.yml#L5)

Additional install-time defense: Convex Helpers' .npmrc sets npm **min-release-age=7** days, distinct from Renovate's 14-day update policy. Age gating and dependency-bot cooldown operate at different stages. [.npmrc L5](https://github.com/convex/convex-helpers/blob/8b87b6c0001313f6b81cc31006a09c7827bc431d/.npmrc#L5)

## Cross-cutting patterns worth copying

1. **Use Changesets for reviewed versions/changelogs** when separately published packages really need them (AI SDK, Effect, Better Auth). For one small library, a core package with React/server subpaths like Convex/Helpers/Zod can avoid needless independent version graphs. Choose separate binding packages when dependencies/lifecycles differ.
2. **Build/test/pack once, publish that exact tarball in a narrow job.** Convex Helpers and T3 show artifact-ID binding; OpenCode adds signer-workflow attestations and manifest allowlists. For a small library, artifact ID + digest validation + expected name/version + ignore-scripts is a reasonable baseline against artifact substitution and credential theft.
3. **Prefer OIDC with explicit registry/provenance and minimal job permissions.** Remove token fallbacks only after verifying npm trust settings. Add a protected environment when the threat is compromised push credentials; Zod/Helpers show a separate staged npm approval model. Stage-only configuration is external and must actually be applied.
4. **Serialize publishing without cancellation; cancel superseded PR checks.** Multi-package publish is irreversible and can partially succeed. AI SDK retries version-PR preparation only; Alchemy skips already published versions; OpenCode/Effect wait for npm visibility before wrappers/latest/docs promotion.
5. **Gate the artifact consumers actually install.** Add strict publint, attw and representative consumer/type-resolution checks; Better Auth demonstrates explicit CI enforcement. A listed devDependency is not proof the check runs. ESM-only vs dual should follow consumer requirements; do not add CJS solely because an older release of a famous repo did.
6. **Separate docs build from deployment credentials.** Static output upload plus narrow deploy job (OpenCode) gives a clearer boundary. For forks, build with read-only token/no secrets; preview deployment requires an explicit reviewed admission mechanism. A host Git integration's policy must be checked separately.
7. **Pin actions to full SHAs and arrange updates.** Expo/Sigstore show grouped Actions updates; add a package-manager age gate and small explicit lifecycle allowlist. pnpm 11/12 repos use allowBuilds, whereas older effect-smol used onlyBuiltDependencies. Match syntax to the pinned pnpm version.
8. **Keep small-library defaults small.** pnpm workspace with package + docs, Changesets, build/types/package checks, OIDC tarball publish, and host-native docs deploy is enough. Native signing matrices, Rust staging branches and SDK synchronization are justified by those products' delivery contracts, not by repo size.

## Anti-patterns observed

- **OIDC permission alongside dependency execution:** Alchemy's workflow-wide id-token scope and several one-job Changesets pipelines leave more code able to request identity than a publisher-only job. Threat: compromised dependency/build script, not just leaked stored token. See Alchemy/Effect/AI/Better Auth/Sigstore sections.
- **Calling a repo tokenless based on one workflow:** historical effect-smol injects NPM_TOKEN despite OIDC setup; current Better Auth keeps token-based dist-tag helper. Check auxiliary promote/tag/bootstrap paths.
- **Inferring npm tags from channel names:** Alchemy beta release spec still goes through a publisher that defaults latest. Inspect the actual publish arguments.
- **Non-reproducible setup in otherwise locked pipelines:** Convex JS npm i, backend Netlify mise self-update, Turborepo docs turbo@canary, floating npm major installs in release workflows. These expand supply-chain variability; some are intentional compatibility tests.
- **Mutable action refs:** T3 release entry and Zod checkout remain tag-pinned while other parts are SHA-pinned. Mixed pinning deserves precise per-workflow language.
- **Explicitly disabling image provenance:** Convex Docker publishing loses attestation evidence; this is a container-specific observation, not an npm accusation.
- **Conflating staging with publication:** Helpers tags successful staging; Zod finishes only once npm serves versions. Tools/docs must represent those states accurately.
- **Assuming docs preview safety from a framework:** Vercel/Netlify config proves intended host integration, not account-level fork settings; PR workflows requiring secrets do not automatically support forks.
- **Copying stale examples:** effect-smol moved; Turborepo release cron is commented; Expo scheduled canary is dry-run. Presence of YAML is not evidence the flow currently ships artifacts.

## Limits of this survey

- Snapshot of default-branch source observed 2026-11-11; all table SHAs are full in link targets. Commits may precede observation. Branches can move; pinned links cannot.
- Identity redirects were verified with GitHub repository API on the observation date; redirects/API metadata are mutable and not commit-pinned. Dotrun identity remains unresolved.
- No installs/builds/publications were executed. No environment/reviewer/branch protection/npm trust settings or live deployment logs inspected. Source comments describing approval gates are design evidence, not proof account settings enforce them.
- All top-level workflow YAMLs were fetched; selected manifests/helpers/configs were inspected. Not all composite actions, remote reusable workflows, release scripts, export maps or generated packages were transitively audited. Module/d.ts claims apply to the named representative package, not every package.
- No inference of absent publishing from absent public workflow: Convex may publish through private/internal automation. “Unknown” intentionally preserves this distinction.
- CI inventory counts lexical workflow declarations, not resolved job permissions. Cache counts are explicit top-level YAML evidence; shared setup actions can hide more. Permission/event observations are not an exploitability assessment.
- Docs hosting marked from checked-in deploy/config evidence; private host integration settings, fork approvals, production domain status and version archive behavior were not externally exercised.
- No broader security incident claim is independently validated here; Zod's incident discussion is attributed to its workflow comment.
- GitHub primary source links support engineering observations; searches were used only for identity discovery/ambiguity. Popularity is not evidence that a pattern is suitable or secure.

