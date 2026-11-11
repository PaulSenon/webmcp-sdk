# 05 — Decisions for the owner

Only the decisions the study can't make for you. Each one has a recommended default, so work can proceed if you accept the defaults. Ordered by when they block.

| ID | Decision | Recommended default | Alternatives / when to choose them | Blocks |
|---|---|---|---|---|
| **D1** | **Published package name.** `webmcp-sdk` and the `@webmcp-sdk` scope are owned by third parties | A scope you own: `@<scope>/sdk` or `@<scope>/webmcp-sdk`. Check the scope is free and register it first. Optionally rename the GitHub repo to match later (GitHub redirects; npm trust must then be updated) | Unscoped free name (e.g. `webmcp-toolkit`): shorter, but it offers no protection against look-alikes and is easier to confuse with the existing `webmcp-sdk`. Asking the owner of `webmcp-sdk` to transfer it is possible, but only realistic if that project is abandoned (it isn't: last update 2026-10-07) | phase 0 → everything |
| **D2** | npm **org** vs **user** scope | **Org** (free for public packages): lets you add a second owner/maintainer later without transferring the package; clearer ownership | User scope `@paulsenon`: zero setup; fine if this stays a personal project | phase 0 |
| **D3** | Docs host | **GitHub Pages**: no account, no token, free; previews = downloadable CI artifacts | **Netlify OSS plan** if live PR previews (including forks, after approval) matter. **Cloudflare Workers static assets** if you already run Cloudflare. **Vercel** only if the docs move to Next/Fumadocs. Custom domain: optional on any of them (needs DNS ownership) | phase 4 |
| **D4** | Support policy | ESM-only; TS consumer floor **5.9**, finalized after the consumer matrix runs; React **18 + 19**; Node **22.12+** (if Node usage is supported at all; the main target is browsers/bundlers); semver: `0.x` with breaking changes in **minor**, then `1.0.0` after API freeze | Dual CJS only on a concrete consumer request; a higher TS floor if 5.9 fails the fixtures | phase 2 |
| **D5** | Solo maintainer or second human? | Solo for now: npm 2FA approval + local rebuild diff is the gate, `release-finalize` is self-approved, ruleset requires PR with 0 approvals and required checks, **no routine bypass** | With a 2nd maintainer: `npm-release` env with required reviewer + *prevent self-review*, 1 required approval, CODEOWNERS enforcement, a 2nd npm org owner (bus factor) | phase 1/3 |
| D6 | How the version PR is made | **Locally**: `pnpm changeset version`, open a PR. No bot permissions; deterministic | GitHub App + `changesets/action` `version` sub-action for an auto-updated "Version Packages" PR. Not with `GITHUB_TOKEN` (its PRs don't trigger the required checks) | phase 2 |
| D7 | Prerelease/canary channels | `next` branch in Changesets pre mode **only when needed**; no automatic canaries | `pkg.pr.new` for per-PR installable builds (third-party app, not on npm); automated snapshot `0.0.0-<sha>` to npm tag `canary` (more stage approvals, more noise) | phase 5 |
| D8 | Docs versioning and design notes | v1: before the first release, one site from `main` with an "unreleased" banner; after it, stable = latest release tag at the base path and `main` at `/next/`. No archives until a 2nd major exists. `docs/design.md` etc. stay internal | Per-version archives `/v/x.y/` once majors diverge. Stable-docs hot-fixes without a release (allowlisted `docs/<version>` branches validated in the resolver), out of v1 | phase 4 |
| D12 | Custom docs domain | none: project Pages URL `https://<owner>.github.io/webmcp-sdk/` (Astro `base` must include `/webmcp-sdk/`) | own domain (DNS + verified domain in GitHub to prevent takeover) | phase 4 |
| D9 | Drift detection | Manual quarterly check against the stored settings snapshot (04 R13) | Weekly OpenSSF Scorecard workflow (`security-events: write` if uploading SARIF) or a small scheduled `gh api` diff job | phase 5 |
| D10 | Licence policy for dependencies | Block strong copyleft in `dependency-review` (`GPL-3.0-only`, `AGPL-3.0-only`) for runtime deps; devDeps informative | No licence gate (one runtime dep today, so the low risk is acceptable) | phase 1 |
| D11 | Repo merge methods | Squash only + delete branch on merge | Keep all three (no technical impact on the release design) | phase 1 |

## What I need from you, and when

1. **Now:** answers to D1/D2 (or "use defaults") and confirmation that you own the chosen scope.
2. **Phase 1 (settings session, ~20 min):** apply 03 §5 GitHub items. I can produce the exact `gh api` commands for you to run or review; this study did not run them.
3. **Phase 3 (~30 min, 2FA device at hand):** bootstrap publish, trusted publisher config (stage-only), "disallow tokens", first npm stage approval.
4. **Phase 4:** enable Pages (source: Actions).
5. **For the adversarial drills:** a second GitHub account or collaborator for the fork-PR test (R4).
