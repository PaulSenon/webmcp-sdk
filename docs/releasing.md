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

(`npm stage` needs npm ≥ 11.15.0: if `npm --version` is older, prefix the commands with `npx --yes npm@11.21.2` instead of `npm`.)

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
4. Approve: `npm stage approve <id>` (2FA), or **Approve** in the **Staged Packages** tab on npmjs.com. Then, in the Actions run, **Review deployments** → `release-finalize` → **Approve and deploy**.

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

Why it is needed: npm lets you configure a trusted publisher only on a package that **already exists** (`npm trust`: "Package must exist"), and a newly created trusted publisher **expires unless it completes its first successful publish within 2 days**. Staging a package that does not exist yet creates it with a public npm placeholder version `0.0.0-stage` ([staged publishing](https://docs.npmjs.com/staged-publishing)). So the package is created once from your machine by staging a code-free placeholder ([`tooling/release/bootstrap/`](../tooling/release/bootstrap/)), which you then **reject**. None of our bytes are published outside CI, and the first real version gets provenance.

All npm commands use one pinned CLI through [`tooling/release/bootstrap.mjs`](../tooling/release/bootstrap.mjs) (`npm@11.21.2`; `npm stage` and `npm trust` need ≥ 11.15.0). Nothing is installed globally. Run everything from the repo root on an up-to-date `main`. npm asks for 2FA itself (browser or prompt); never paste a code or token anywhere else.

Prerequisites: npm account `psenon` with 2FA enabled (a security key/passkey is preferred), member of the npm org `senon` with the role **owner** or **admin**.

| # | Step | Command / place | Expected |
|---|---|---|---|
| 1 | Log in (browser) | `npx --yes npm@11.21.2 login` | `Logged in on https://registry.npmjs.org/.` |
| 2 | Preflight (read-only) | `node tooling/release/bootstrap.mjs check` | `OK` lines: logged in as `psenon`, org `senon` role `owner`/`admin`, package does not exist yet |
| 3 | Create the package | `node tooling/release/bootstrap.mjs stage` | a stage ID for `@senon/webmcp-sdk@0.0.0-bootstrap.0`, dist-tag `bootstrap` |
| 4 | Reject the placeholder (2FA) | `node tooling/release/bootstrap.mjs reject <stage-id>` | `OK stage rejected; @senon/webmcp-sdk exists with versions ["0.0.0-stage"]` |
| — | *Steps 5–8 in one sitting (the trust config expires after 2 days without a publish).* | | |
| 5 | Trusted publisher, stage-only (2FA) | `node tooling/release/bootstrap.mjs trust` | `npm trust list` shows GitHub · `PaulSenon/webmcp-sdk` · `release.yml` · `npm-release`, with stage publish only |
| 6 | First release | merge the version PR for `0.1.0`, then sections 3–5 | `0.1.0` on npm with provenance, tag and GitHub release |
| 7 | Lock down | npmjs.com → `@senon/webmcp-sdk` → **Settings** → **Publishing access** → **Require two-factor authentication and disallow tokens** → **Update Package Settings** | trusted publishing keeps working; no token can publish |
| 8 | Log out | `npx --yes npm@11.21.2 logout` | the CLI session token is revoked |

Fallbacks:

- **`stage` refuses because the package does not exist** (npm docs and some third-party write-ups disagree): publish the placeholder directly once, `npx --yes npm@11.21.2 publish tooling/release/bootstrap --tag bootstrap --access public` (2FA), then continue at step 5. After `0.1.0`: `npx --yes npm@11.21.2 deprecate @senon/webmcp-sdk@0.0.0-bootstrap.0 "placeholder, not a release"` and `npx --yes npm@11.21.2 dist-tag rm @senon/webmcp-sdk bootstrap`.
- **The package disappears after the rejection** (`reject` reports it): run `stage` again, approve the placeholder this time (`npx --yes npm@11.21.2 stage approve <id>`), then apply the post-release clean-up above.
- **The trust config expired** (more than 2 days without a successful publish): `npx --yes npm@11.21.2 trust list @senon/webmcp-sdk`, then `npx --yes npm@11.21.2 trust revoke @senon/webmcp-sdk --id <id>`, and run step 5 again.
- **If `senon` is not yours:** use your user scope (`@psenon/webmcp-sdk`) or a verified-free unscoped name; the rename touches `packages/webmcp-sdk/package.json`, the imports, the tag ruleset pattern and this runbook.
