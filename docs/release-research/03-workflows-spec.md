# 03 — Workflow, trigger, permission and settings specification

**These are specification snippets, not active files.** `<sha>` placeholders must be resolved to full commit SHAs at implementation time (`gh api repos/OWNER/REPO/git/ref/tags/TAG`, dereferencing annotated tags via `git/tags/<sha>`), keeping the tag as a trailing comment. Versions are as observed 2026-11-11. This revision includes the fixes from the adversarial review (`raw/D-critique.md`, findings D01–D22). Items still marked **(verify)** must be proven in the dry runs ([04 §5](04-inventory-migration.md#5-test-plan-dry-runs-adversarial-scenarios-rollback)).

Paths assume the target layout (`packages/sdk`). Before phase 2b, read them as the repo root.

Conventions for every workflow:
- top-level `permissions: {}`; each job grants only what it needs;
- `actions/checkout` with `persist-credentials: false`;
- dispatch inputs and event text reach the shell **only through `env:`**, always quoted. Node helpers use `execFile` with argument arrays and `--notes-file`, never shell interpolation of version/ref/notes;
- `runs-on: ubuntu-24.04` (GitHub-hosted, required for npm OIDC); `timeout-minutes` on every job;
- no `pull_request_target`, no `workflow_run`, no comment-triggered execution.

## 1. `ci.yml` — untrusted-safe checks (PRs incl. forks, and pushes)

```yaml nocheck
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions: {}
concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true          # CI has no side effects

jobs:
  checks:                            # required
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false, fetch-depth: 0 }   # base history for the changeset check
      - uses: pnpm/action-setup@<sha> # v6.1.1 — reads packageManager
      - uses: actions/setup-node@<sha> # v7.1.0
        with: { node-version-file: .nvmrc, cache: pnpm }       # cache OK: job holds no authority
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter <pkg> run build                    # BEFORE anything that resolves the package's exports (D08)
      - run: pnpm -r run typecheck && pnpm -r run test
      - run: pnpm run check:docs                              # snippets resolve <pkg> through built exports
      - if: github.event_name == 'pull_request'
        env: { BASE_REF: "${{ github.base_ref }}" }
        run: node tooling/release/check-changeset.mjs "origin/$BASE_REF"   # see rule below (D07)

  browser:                           # required
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      # checkout / pnpm / node / install as above
      - run: pnpm --filter <pkg> exec playwright install --with-deps chromium
      - run: pnpm --filter <pkg> run test:browser

  package:                           # required — tests the artifact, not the sources
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      # checkout / pnpm / node / install as above
      - run: pnpm --filter <pkg> run build
      - run: node tooling/release/pack.mjs "$RUNNER_TEMP/out"   # same script as release: pack + publint --strict + attw + consumers

  docs:                              # required once apps/docs exists
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions: { contents: read }
    steps:
      # checkout / pnpm / node / install as above
      - run: pnpm --filter <pkg> run build && pnpm --filter docs run build
      - if: github.event_name == 'pull_request'
        uses: actions/upload-artifact@<sha> # v7.0.2
        with: { name: docs-preview, path: apps/docs/dist, retention-days: 7 }

  workflow-lint:                     # required
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false }
      - uses: zizmorcore/zizmor-action@<sha> # v0.8.1
        with:
          version: "1.32.0"          # the wrapper pin does NOT pin the tool (default: latest) (D13)
          advanced-security: false   # no SARIF upload → no security-events: write
          annotations: true
          online-audits: false       # deterministic, no token use; enable deliberately if wanted
      - name: actionlint (release binary, checksum-verified)   # rhysd/actionlint is not an action (D12)
        env: { V: "1.7.12", SHA256: "<sha256 of actionlint_1.7.12_linux_amd64.tar.gz from the release checksums file>" }
        run: |
          set -euo pipefail
          curl -fsSLo al.tgz "https://github.com/rhysd/actionlint/releases/download/v${V}/actionlint_${V}_linux_amd64.tar.gz"
          echo "${SHA256}  al.tgz" | sha256sum -c -
          tar -xzf al.tgz actionlint && ./actionlint -color

  dependency-review:                 # required (vulnerabilities); licence gate per D10
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: { contents: read }
    steps:
      - uses: actions/dependency-review-action@<sha> # v5.0.0
        with:
          fail-on-severity: high
          fail-on-scopes: runtime    # (D20) dev-scope findings reported, not blocking
          # deny-licenses: …         # only if D10 = licence gate; scope it to runtime the same way
```

**Changeset rule (`check-changeset.mjs`, D07).** Plain `changeset status` fails on the version PR itself, because that PR consumes the change files. The check therefore passes when **either**:
1. the PR adds ≥ 1 change file (or an explicit empty one, for docs/CI-only PRs), **or**
2. the PR is a *valid version PR*, judged by its content and never by branch name or label: the version field changed, and it equals the version that `changeset status --output` computes **on the base commit**. Every top-level change file present on the base is consumed (Changesets 3 moves prerelease files into `.changeset/pre/`, so use the CLI's own state, and ignore `.changeset/README.md`). `CHANGELOG.md` gains exactly that `## <version>` section. The PR touches nothing else outside `package.json`/`CHANGELOG.md`/`.changeset/`.

Required checks get skipped/neutral states right only if job names are stable; never rename a required job without updating the ruleset.

## 2. `release.yml` — the only npm-trusted workflow

npm trusted publisher (set on npmjs.com): **owner** `<owner>`, **repo** `webmcp-sdk`, **workflow** `release.yml`, **environment** `npm-release`, permissions **stage only** (direct publish off, dist-tag off). Renaming this file or the environment requires a new trust config, which must be validated within 2 days.

Scope (deliberately narrow, D05/D21): it releases **the version currently on the head of `main`** (or `next`). It does not repair historical versions; that is the manual runbook in §4.

```yaml nocheck
name: release
on:
  workflow_dispatch:
    inputs:
      confirm_version:
        description: "Exact version to release; must equal packages/sdk/package.json"
        required: true
        type: string
permissions: {}
concurrency:
  group: release
  cancel-in-progress: false   # never kill a running release. NB: GitHub keeps at most ONE pending run per group;
                              # a newer dispatch replaces an older pending one (D22) — dispatch once, re-run jobs instead.

jobs:
  plan:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: { contents: read }
    outputs:
      sha: ${{ steps.r.outputs.sha }}
      name: ${{ steps.r.outputs.name }}
      version: ${{ steps.r.outputs.version }}
      dist_tag: ${{ steps.r.outputs.dist_tag }}
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false, ref: "${{ github.sha }}" }
      - uses: actions/setup-node@<sha> # v7.1.0
        with: { node-version: "26.13.0", package-manager-cache: false }
      - id: r
        env:
          REF: ${{ github.ref }}
          SHA: ${{ github.sha }}
          EXPECTED: ${{ inputs.confirm_version }}
        run: node tooling/release/plan.mjs
```

`plan.mjs` (plain Node, no dependencies) fails closed unless all of these hold:
1. `REF` ∈ {`refs/heads/main`, `refs/heads/next`}. The environment policy enforces the same thing (defence in depth).
2. `EXPECTED` matches a strict semver regex **and** equals `version` in `packages/sdk/package.json`.
3. `dist_tag` is derived, never input: a stable version gets `latest` and is allowed only from `main`; `x.y.z-next.N` gets `next` and is allowed only from `next`; anything else fails.
4. Changesets state is clean per the CLI: no pending change files; pre mode is absent on `main` and present (tag `next`) on `next`.
5. `CHANGELOG.md` has a `## <version>` section.
6. Registry: `npm view <name>@<version> version --json`. **Absent (E404/ETARGET only)** → continue. **Present** → fail: "already published; if tag/release are missing, re-run the failed `finalize` job of the original run, or follow the §4 runbook". Any other error (network, 5xx, auth) also fails; it never counts as "absent".
7. Remote tag `<name>@<version>` must not exist.

```yaml nocheck
  build:                       # runs all repository/third-party dependency code; holds NO identity
    needs: plan
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions: { contents: read }
    cache-mode: none           # job-level key, verified (D14): no cache restore/save in the release path
    outputs:
      artifact_id: ${{ steps.up.outputs.artifact-id }}
      integrity: ${{ steps.pack.outputs.integrity }}
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false, ref: "${{ needs.plan.outputs.sha }}" }
      - uses: pnpm/action-setup@<sha> # v6.1.1
      - uses: actions/setup-node@<sha> # v7.1.0
        with: { node-version-file: .nvmrc, package-manager-cache: false }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter <pkg> run build
      - run: pnpm -r run typecheck && pnpm -r run test && pnpm run check:docs
      - run: pnpm --filter <pkg> exec playwright install --with-deps chromium && pnpm --filter <pkg> run test:browser
      - id: pack
        env: { NAME: "${{ needs.plan.outputs.name }}", VERSION: "${{ needs.plan.outputs.version }}", SHA: "${{ needs.plan.outputs.sha }}" }
        run: node tooling/release/pack.mjs "$RUNNER_TEMP/out"
      - id: up
        uses: actions/upload-artifact@<sha> # v7.0.2
        with: { name: "release-${{ needs.plan.outputs.version }}", path: "${{ runner.temp }}/out", retention-days: 30, if-no-files-found: error }
```

`pack.mjs`: run `pnpm pack` **once**, producing `out/pkg.tgz`. Run `publint --strict out/pkg.tgz` and `attw out/pkg.tgz --profile esm-only`, plus the consumer fixtures against that file. Assert that the tar contains only `package/{package.json,README.md,LICENSE,CHANGELOG.md,dist/**}`. Assert that `package/package.json` has the expected name and version, contains no `workspace:`/`catalog:` specifiers, and has **no `publishConfig` keys other than `access`** (D-review §5: `publishConfig` can override registry/provenance). Write `out/release-manifest.json` (`name`, `version`, `sha`, `integrity`, `files[]` with per-file sha256, size, run URL). Output `integrity = "sha512-" + base64(sha512(pkg.tgz))`, which is the same value npm stores as `dist.integrity` (verified in the npm 11.20 source).

```yaml nocheck
  stage:                       # holds the npm identity; runs no repository dependencies and no lifecycle scripts
    needs: [plan, build]
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    environment: npm-release   # deployment branches: main, next. No reviewers (solo, D5)
    permissions: { contents: read, id-token: write }
    cache-mode: none
    steps:
      # no checkout: nothing from the repository executes here.
      # Still trusted: hosted image, setup-node, download-artifact (pinned), Node 26.13.0 + bundled npm 11.20.0.
      - uses: actions/setup-node@<sha> # v7.1.0
        with: { node-version: "26.13.0", package-manager-cache: false }
      - uses: actions/download-artifact@<sha> # v8.0.2 — single id ⇒ extracted directly into path; digest-mismatch defaults to error
        with: { artifact-ids: "${{ needs.build.outputs.artifact_id }}", path: in }
      - env:
          EXPECTED_INTEGRITY: ${{ needs.build.outputs.integrity }}
          NAME: ${{ needs.plan.outputs.name }}
          VERSION: ${{ needs.plan.outputs.version }}
          DIST_TAG: ${{ needs.plan.outputs.dist_tag }}
        run: |
          set -euo pipefail
          cd "$RUNNER_TEMP" && mkdir -p clean && cd clean          # no project .npmrc in scope
          tgz="$GITHUB_WORKSPACE/in/pkg.tgz"; test -f "$tgz"      # fixed path, no glob fallback (D01)
          actual="sha512-$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)"
          [ "$actual" = "$EXPECTED_INTEGRITY" ] || { echo "::error::tarball integrity mismatch"; exit 1; }
          tar -xOzf "$tgz" package/package.json | node -e '
            const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
            const pc = Object.keys(m.publishConfig ?? {});
            if (m.name !== process.env.NAME || m.version !== process.env.VERSION || pc.some(k => k !== "access")) process.exit(1);'
          npm stage publish "$tgz" --tag "$DIST_TAG" --access public --ignore-scripts --json > stage.json   # flags verified in npm 11.20 source
          {
            echo "### Staged \`$NAME@$VERSION\` → dist-tag \`$DIST_TAG\`"
            echo "- stage: \`$(node -p 'require("./stage.json").id ?? JSON.stringify(require("./stage.json"))')\`"   # (verify) exact JSON field
            echo "- integrity: \`$actual\`"
            echo "- source SHA: \`${{ needs.plan.outputs.sha }}\`"
            echo "Before approving on npm: follow the approval checklist (§4). Do not rely on this summary alone."
          } >> "$GITHUB_STEP_SUMMARY"
```

The summary exists **before** npm approval (D09). It is a convenience written by the same pipeline, though, so the approval checklist in §4 uses evidence the build could not forge.

```yaml nocheck
  finalize:                    # records the release; no npm identity
    needs: [plan, build, stage]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: release-finalize   # required reviewer = maintainer, approved AFTER approving on npm. The wait holds no runner,
                                    # but keeps the run (and the release concurrency group) open, up to the 30-day env limit.
    permissions: { contents: write }   # + actions: write only if it dispatches docs.yml
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false, ref: "${{ needs.plan.outputs.sha }}" }
      - uses: actions/download-artifact@<sha> # v8.0.2 — finalize needs the tested bytes too (D02)
        with: { artifact-ids: "${{ needs.build.outputs.artifact_id }}", path: in }
      - uses: actions/setup-node@<sha> # v7.1.0
        with: { node-version: "26.13.0", package-manager-cache: false }
      - env:
          GH_TOKEN: ${{ github.token }}
          NAME: ${{ needs.plan.outputs.name }}
          VERSION: ${{ needs.plan.outputs.version }}
          SHA: ${{ needs.plan.outputs.sha }}
          DIST_TAG: ${{ needs.plan.outputs.dist_tag }}
          EXPECTED_INTEGRITY: ${{ needs.build.outputs.integrity }}
        run: node tooling/release/finalize.mjs in/pkg.tgz in/release-manifest.json
```

`finalize.mjs` is idempotent when re-run as *Re-run failed jobs* in the same run (D04):
1. Re-hash `in/pkg.tgz`; it must equal `EXPECTED_INTEGRITY`. Poll `npm view "$NAME@$VERSION" dist.integrity` (bounded, about 5 min). Absent → fail with "not approved on npm yet, or rejected" and create nothing. Present but different → **incident**: stop.
2. `npm view "$NAME" dist-tags.$DIST_TAG` ≠ `VERSION` → warning only (dist-tags are manual).
3. Query **tag and release independently**, because draft releases do not materialize their tag:

   | tag `<name>@<v>` | release | action |
   |---|---|---|
   | absent | absent | create **draft** with `--target "$SHA"`, `--notes-file` from the CHANGELOG section, upload `pkg.tgz` + `release-manifest.json`, then publish (immutable ⇒ tag locked) |
   | absent | draft | verify the draft's assets match (hash); upload any missing ones; publish |
   | at `SHA` | absent | create the release on the existing tag, then upload and publish as above |
   | at `SHA` | published | verify assets by hash: match → success (no-op); mismatch or missing → **fail** (an immutable release can't be fixed; record it in the runbook) |
   | elsewhere | any | **fail**; possible compromise; never move |

   Re-read the peeled tag immediately before publishing the draft, and re-verify tag + asset hashes afterwards.
4. Prerelease flag for `next`; never mark a `next` version as GitHub "latest".
5. Known limit (D05): the release API refuses the `GITHUB_TOKEN` when the target commit's `.github/workflows/` differs from the default branch's. That is normal for `main` HEAD, possible for `next`. The fix is manual (`gh release create` by the maintainer) or a narrowly scoped GitHub App later; `workflows: write` is not a valid `GITHUB_TOKEN` permission.

## 3. `docs.yml` — site deploy, separate identity

```yaml nocheck
name: docs
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      stable_tag:
        description: "Release tag to serve as stable (default: latest non-prerelease release)"
        required: false
        type: string
permissions: {}
concurrency: { group: pages, cancel-in-progress: false }

jobs:
  build:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: { persist-credentials: false, fetch-depth: 0 }
      - env: { STABLE_TAG: "${{ inputs.stable_tag }}", GH_TOKEN: "${{ github.token }}" }
        run: node tooling/docs/resolve-stable.mjs   # tag must match ^<pkg>@\d+\.\d+\.\d+$ and have a published release
      # Build each version into its own temp dir, then compose once (D16):
      #   main  → $RUNNER_TEMP/next  with Astro base "/webmcp-sdk/next/" (project Pages prefix; "/next/" only with a custom domain)
      #   stable tag (git worktree) → $RUNNER_TEMP/stable with base "/webmcp-sdk/"
      #   compose: site/ = stable/ + site/next/ = next/ ; write site/build-info.json {stable_tag, stable_sha, next_sha}
      # Before the first release: only main, served at the base path with an "unreleased" banner.
      - uses: actions/upload-pages-artifact@<sha> # v5.0.0
        with: { path: site }

  deploy:
    needs: build
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }   # deployment branch: main only
    permissions: { pages: write, id-token: write }
    steps:
      - id: d
        uses: actions/deploy-pages@<sha> # v5.0.1
```

- **Isolation from npm:** this workflow's OIDC token names `docs.yml` and never gets environment `npm-release`, so npm rejects it.
- **Docs build is still a supply-chain surface** (MDX, plugins, dependencies of old tags). A compromised build can serve malicious static content from the official origin without touching npm. Mitigations: same pnpm policy, no secrets in the job, a pinned docs toolchain, and rollback to a known-good *artifact*. Keep the last good Pages artifact ID in the runbook.
- **After a release:** a release created by `GITHUB_TOKEN` triggers no workflows. Either `finalize` runs `gh workflow run docs.yml -f stable_tag=…` (adds `actions: write` to that job only), or the maintainer dispatches it. Recommended: the dispatch step.
- **Rollback:** dispatch on `main` with `stable_tag: <previous tag>`. The environment policy always sees `refs/heads/main` (the run ref), so content refs are validated by `resolve-stable.mjs`, not by the environment (D15). Stable docs hot-fixes without a package release are **out of v1**. If needed later, accept an allowlisted `docs/<version>` branch whose head descends from the release tag, validated in the resolver; no environment exception.
- **Fork previews:** none deployed. Live previews are optional via Netlify (D3) and its own fork-approval mechanism; never through `pull_request_target`.

## 4. Runbooks: approval, recovery, rollback

### Approval checklist (before `npm stage approve`, 2FA)
1. The staged version and dist-tag are the ones you dispatched, and there is **one** pending stage for this package (`npm stage list <pkg>`). Reject leftovers. Approving an old stage could move `latest` backwards (D10).
2. `npm stage download <id>` (or the npm UI) → its sha512 equals the integrity in the run summary **and** in the release artifact.
3. **Independent check, the one a compromised CI build can't forge:** on your machine, `git checkout <SHA> && pnpm install --frozen-lockfile && pnpm --filter <pkg> build && pnpm --filter <pkg> pack`. Then `diff -r` the extracted contents against the staged tarball. Compare file contents, not tar bytes: tarball byte-reproducibility isn't guaranteed. A difference means stop and reject. This takes about 2 minutes for this package, and it is the only step that doesn't trust the CI build. (It does trust your machine: see T8.)
4. Approve on npm, then approve `release-finalize` in GitHub.

### Recovery matrix
| Situation | Action |
|---|---|
| `build` fails | fix by PR; the version is unchanged; dispatch again |
| `stage` fails before upload (integrity mismatch, OIDC refused) | integrity mismatch = **incident** (inspect run, artifact list); OIDC refused = check trust config/env name |
| `stage` fails because a stage for this version already exists (lost run) | `npm stage list`: either approve that stage (if its hash matches a run you trust) and run finalize by hand, or `npm stage reject` it and dispatch again. npm documents re-staging the same version after rejection |
| Staged, you **reject** it | `finalize` fails cleanly; fix; dispatch again (same version allowed) |
| Approved on npm, `finalize` failed or expired | *Re-run failed jobs* on that run, while its artifact exists (30 days) |
| Approved on npm, original run unusable (artifact expired, workflows changed) | **manual**: `npm pack <name>@<v>` gives the registry tarball. Verify it with an audited verifier: `npm audit signatures` in a scratch project installing exactly that version with `--ignore-scripts`. Read the SLSA v1 provenance: `predicate.buildDefinition.externalParameters.workflow.{repository,path,ref}`, `resolvedDependencies[].digest.gitCommit`, and the subject PURL + hex sha512 matching the tarball. Then `gh release create <name>@<v> --target <gitCommit> --draft …`, upload, publish. Mark the release notes "assets recovered from registry". Don't invent original run evidence |
| Bad version published | `npm deprecate <name>@<v> "<reason>"`. If it was `latest`: `npm dist-tag add <name>@<prev-good> latest` (2FA). Then ship a fix release. Unpublish only within npm policy |
| Tag exists at an unexpected SHA, or registry integrity ≠ artifact | stop; treat as possible compromise; never move tags |
| Unexpected stage (not yours) | `npm stage reject`; revoke GitHub sessions/PATs; audit recent runs, env/ruleset/trust settings; then see T8 |
| Maintainer machine suspected | from a clean device: revoke npm sessions and GitHub sessions/PATs, rotate passkeys, reject all pending stages, check trust configs and package settings, review recent releases. Approvals made from a compromised device are not independent review |

## 5. Settings specification (owner checklist)

**npm**
- [ ] Account 2FA with WebAuthn/passkey; no TOTP.
- [ ] Scope/org created (D1/D2); owners list minimal, plus a second owner if D5.
- [ ] Bootstrap (04 phase 3), then a trusted publisher for `release.yml` / `npm-release` / **stage only**.
- [ ] Package setting **Require two-factor authentication and disallow tokens**; `npm token list` shows no write tokens.

**GitHub repo**
- [ ] Actions › General: allowed actions = GitHub-owned + selected (`pnpm/action-setup@*`, `zizmorcore/zizmor-action@*`); **require full-SHA pinning**; fork PR workflows: **require approval for all outside contributors**; workflow permissions read (already); Actions may not create/approve PRs (already).
- [ ] Environments: `npm-release` (deployment branches `main`, `next`; no secrets; admin bypass off). `release-finalize` (required reviewer: maintainer; branches `main`, `next`). `github-pages` (branch `main`).
- [ ] Ruleset `main` (and `next` when it exists): require PR with **0 approvals** (solo; 1 with a second maintainer), required checks `checks`, `browser`, `package`, `workflow-lint`, `dependency-review` (+ `docs`), block force push and deletion. **No routine bypass actors** (D06): a bypass also skips the required checks. If an emergency bypass is kept, document which rules it skips and review each use.
- [ ] Ruleset for tags `<pkg>@*` and `v*`: block update and deletion, no bypass. Creation restriction is optional and **unverified** for the Actions token. Published immutable releases lock their tags anyway.
- [ ] Releases: **enable immutability**.
- [ ] Security: secret scanning + push protection, Dependabot alerts, **private vulnerability reporting**, `SECURITY.md`.
- [ ] Pages source: GitHub Actions. Merge: squash only, delete branch on merge (D11).
- [ ] Export the resulting settings (`gh api …/rulesets`, `…/environments`, `…/actions/permissions`) into a reference snapshot for drift checks (04 R13).

## 6. Dependency policy files (snippets)

`pnpm-workspace.yaml` (pnpm 11.28.x; key names checked against the published 11.28.6 archive by the review). A settings-only file without `packages` is valid for a single root package:

```yaml nocheck
packages: [packages/*, apps/*, tooling/*]   # omit until phase 2b
minimumReleaseAge: 4320                     # 3 days, in minutes; explicit ⇒ strict
minimumReleaseAgeIgnoreMissingTime: false   # fail closed when publish time is missing (D18)
minimumReleaseAgeExclude: []                # exact versions only, for urgent security fixes, each with a comment
trustLockfile: false                        # (default since 11.3) re-verify locked entries
strictDepBuilds: true
allowBuilds: {}                             # after the first install, record a reasoned true/false for every package with hooks
blockExoticSubdeps: true                    # blocks indirect git/tarball deps; direct exotic deps still need review
trustPolicy: no-downgrade                   # metadata-trust regression check, not malware detection
```

`packageManager` (D19): `"pnpm@11.28.<patch>+sha512.<hex digest>"`. That is an exact patch with a **hex** sha512 of the pnpm tarball, *not* the registry's base64 SRI. CI asserts `pnpm --version`. Confirm at implementation whether `pnpm/action-setup` enforces the hash. `.nvmrc`: an exact Node version (e.g. `26.13.0`). The published package's `engines` states the *consumer* floor (D4), never the tooling version.

`.github/dependabot.yml`: Dependabot officially supports pnpm 11/12 since [2026-10-20](https://github.blog/changelog/2026-10-20-dependabot-now-supports-npm-12-pnpm-11-and-12-and-bun-1-4/) (D17). The first PR is still an integration smoke test.

```yaml nocheck
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    cooldown: { default-days: 7, semver-major-days: 14 }   # ≥ pnpm minimumReleaseAge; security updates are not delayed by cooldown
    versioning-strategy: increase-if-necessary             # don't narrow the library's public ranges
    groups:
      dev-minor-patch: { dependency-type: development, update-types: [minor, patch] }
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
    cooldown: { default-days: 7 }
    groups: { actions: { patterns: ["*"] } }
```

Known friction: a *transitive* dependency younger than the threshold can make a Dependabot PR fail the strict release-age check ([write-up](https://dev.classmethod.jp/en/articles/pnpm-11-minimum-release-age-dependabot-ci-failure/)). That is the intended behavior: wait, then re-run. Fallback updater: Renovate (free hosted; `minimumReleaseAge`, `helpers:pinGitHubActionDigests`).

Review policy: no auto-merge in v1. Bot PRs are untrusted input like any other PR: read the lockfile diff for new packages, hooks, or git/URL sources. Majors, anything touching `.github/`, `tooling/release/` or `pnpm-workspace.yaml`, and new actions get a changelog and diff read. Bot names are never special-cased in any workflow.

`.github/CODEOWNERS` (enforced only with a second maintainer):

```text
/.github/                   @<owner>
/tooling/release/           @<owner>
/pnpm-workspace.yaml        @<owner>
/packages/sdk/package.json  @<owner>
```
