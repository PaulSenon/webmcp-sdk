# Releasing `@senon/webmcp-sdk`

Maintainer runbook. Design, threat model and alternatives: [`docs/release-research/`](release-research/README.md).

Releases are **explicit**: nothing is published on push or merge. You start a release by hand, CI builds and *stages* one tarball, and the version only becomes installable when you approve it on npm with 2FA.

```
PRs with change notes ─► version PR (pnpm changeset version) ─► merge
  ─► Actions › release › Run workflow (main, confirm_version)
  ─► plan → build (tests, pack once) → stage (OIDC, npm stage publish)
  ─► YOU: approval checklist, then approve on npmjs.com (2FA)
  ─► YOU: approve the "release-finalize" environment in the run
  ─► finalize: npm bytes == built bytes → tag @senon/webmcp-sdk@x.y.z + immutable GitHub release
```

## 1. Every pull request

A change to `packages/webmcp-sdk` needs a change note: `pnpm changeset` (pick the bump, write the changelog line for users). Use `pnpm changeset --empty` for changes that need no release. CI (`checks` → *Change note*) enforces this. While the version is `0.x`, breaking changes are `minor`.

## 2. Version PR

```sh
git switch -c release/next main && git pull
pnpm changeset version          # bumps packages/webmcp-sdk/package.json, writes CHANGELOG.md, deletes the notes
pnpm install --frozen-lockfile  # sanity (no lockfile change expected)
git commit -am "Version @senon/webmcp-sdk x.y.z" && git push -u origin HEAD
gh pr create --fill
```

Review the CHANGELOG text: it becomes the GitHub release notes. CI validates that the version equals what the notes compute and that the PR touches only the manifest, CHANGELOG and `.changeset/`. Merge.

## 3. Release run

GitHub → Actions → **release** → *Run workflow* on `main` → `confirm_version` = the new version. Or:

```sh
gh workflow run release.yml --ref main -f confirm_version=x.y.z
```

`plan` refuses: another branch, a version mismatch, pending change notes, a missing CHANGELOG section, a version already on npm, or an existing tag. Dispatch **once**: a second dispatch replaces a pending one (GitHub keeps one pending run per concurrency group). To retry, use *Re-run failed jobs*.

## 4. Approval checklist (before approving on npm)

The staged version can only become public through you. This is the step that a compromised CI build cannot fake, so do it every time:

1. **One stage, the expected one:** `npm stage list @senon/webmcp-sdk` (logged in) shows exactly the version you dispatched, with the dist-tag `latest` (or `next`). Reject anything else.
2. **Same bytes as the run:** download the staged tarball (`npm stage download <id>`, or from the npmjs UI), then `openssl dgst -sha512 -binary <file> | base64`. Prefixed with `sha512-`, it must equal the *integrity* shown in the run's `build` and `stage` summaries.
3. **Same contents as the source** (independent rebuild on your machine):
   ```sh
   git fetch && git switch --detach <source SHA from the summary>
   pnpm install --frozen-lockfile
   (cd packages/webmcp-sdk && node scripts/test-package.mjs --out /tmp/local-build)
   node tooling/release/compare-tarballs.mjs <staged.tgz> /tmp/local-build/pkg.tgz
   ```
   Any difference: **reject** (`npm stage reject <id>`) and investigate.
4. Approve on npmjs.com (2FA). Then, in the Actions run, approve the **release-finalize** environment.

## 5. Finalize

`finalize` re-checks that npm serves the same integrity, then creates the tag `@senon/webmcp-sdk@x.y.z` at the source SHA and an immutable GitHub release with `pkg.tgz` and `release-manifest.json`. If it fails (npm not visible yet, API error), use *Re-run failed jobs*: it is idempotent and the artifact is kept for 30 days.

Verify: `npm view @senon/webmcp-sdk@x.y.z dist.integrity` matches, the npm page shows provenance, `gh release verify @senon/webmcp-sdk@x.y.z` passes.

## 6. When things go wrong

| Situation | Do |
| - | - |
| `build` failed | fix by PR, dispatch again (same version) |
| `stage`: integrity mismatch | **incident**: stop, inspect the run; do not retry blindly |
| `stage`: OIDC refused | check the npm trusted publisher (workflow `release.yml`, environment `npm-release`) |
| `stage`: a stage already exists for this version (lost run) | `npm stage list`: approve it if it matches a run you trust (then finalize by hand, below), else `npm stage reject` and dispatch again |
| You rejected the stage | fix, dispatch again: npm allows re-staging the same version after a rejection |
| Approved, `finalize` failed | *Re-run failed jobs* on that run |
| Approved, run unusable (artifact expired, workflows changed since) | manual: `npm pack @senon/webmcp-sdk@x.y.z`; check `npm audit signatures` in a scratch project depending on that exact version; read the provenance commit on the npm page; `gh release create @senon/webmcp-sdk@x.y.z --target <commit> --draft --notes "assets recovered from the registry"`, upload the tarball, publish |
| Bad version published | `npm deprecate @senon/webmcp-sdk@x.y.z "<reason>"`; if it was `latest`: `npm dist-tag add @senon/webmcp-sdk@<previous good> latest`; then a fix release. Versions are immutable on npm; unpublish only within npm's policy |
| A tag exists at an unexpected commit, or npm integrity ≠ build | stop; treat as a possible compromise; never move tags |
| A stage you did not start | `npm stage reject`; revoke GitHub sessions/tokens; review recent runs and the repository settings |
| Your machine may be compromised | from a clean device: revoke npm and GitHub sessions, rotate passkeys, reject pending stages, review trust settings and recent releases |

## 7. Prereleases (when needed)

On a `next` branch: `pnpm changeset pre enter next`, then version PRs into `next` as usual. Dispatch `release.yml` on `next`: versions `x.y.z-next.N` go to the npm dist-tag `next`. Exit with `pnpm changeset pre exit` before merging back to `main`.

## 8. One-time bootstrap (first publish)

npm documents that a staged publish can create a new package, but not whether a trusted publisher can be configured *before* the package exists. So, once:

1. **Check the scope.** On npmjs.com, logged in as your npm user, confirm that you own the org/user `senon`. `@senon/image-sizes` is published by `psenon`, which suggests you do: **Organizations → senon**. If `senon` is not yours, see the alternatives in the PR description.
2. **Account security:** 2FA with a passkey/security key (Account → Two-Factor Authentication).
3. **Placeholder version** (explicit provenance exception): build it from a clean checkout of `main`:
   ```sh
   cd packages/webmcp-sdk && npm pkg set version=0.0.0-bootstrap.0 && node scripts/test-package.mjs --out /tmp/boot && git checkout package.json
   npm login                                   # 2FA
   npm stage publish /tmp/boot/pkg.tgz --tag bootstrap --access public
   npm stage approve <id>                      # 2FA
   ```
   If the npmjs UI already offers a trusted publisher for the unpublished name, skip this step.
4. **Trusted publisher:** npmjs.com → `@senon/webmcp-sdk` → Settings → Trusted publishing → GitHub Actions: owner `PaulSenon`, repository `webmcp-sdk`, workflow `release.yml`, environment `npm-release`. Allow **staged publishing only** (no direct publish, no dist-tag). The config expires if unused for 2 days, so do steps 5–6 right after.
5. **First real release:** merge the version PR for `0.1.0`, then sections 3–5 above.
6. **Lock down:** package Settings → Publishing access → **Require two-factor authentication and disallow tokens**. Then `npm dist-tag rm @senon/webmcp-sdk bootstrap` and `npm deprecate @senon/webmcp-sdk@0.0.0-bootstrap.0 "placeholder, not a release"`. Run `npm token list` and revoke any write token.
