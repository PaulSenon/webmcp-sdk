# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on
[PaulSenon/webmcp-sdk](https://github.com/PaulSenon/webmcp-sdk/security/advisories/new).
Do not open a public issue. You should get an answer within a week.

## Supported versions

Only the latest published version of `@senon/webmcp-sdk` receives fixes (the package is `0.x`).

## How releases are made

Published versions come only from `.github/workflows/release.yml` through npm trusted publishing
(OIDC, no tokens), are staged and then approved by the maintainer with 2FA, and carry npm provenance.
Each release has an immutable GitHub release with the exact tarball and a manifest of its files.
Check provenance with `npm audit signatures` in a project that depends on the package.
Details: [docs/releasing.md](docs/releasing.md).
