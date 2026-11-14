<img src="packages/webmcp-sdk/assets/icon.svg" width="64" height="64" alt="">

# webmcp-sdk

Type-safe [WebMCP](https://webmachinelearning.github.io/webmcp/) tools for TypeScript. Define tools with Standard Schema, implement them with inferred types, register them with validation and agent-readable errors, and discover them from an in-page agent. React bindings included.

**Package documentation: [`packages/webmcp-sdk/README.md`](packages/webmcp-sdk/README.md)** (published as [`@senon/webmcp-sdk`](https://www.npmjs.com/package/@senon/webmcp-sdk), not released yet).

> Not affiliated with the unrelated `webmcp-sdk` or `@webmcp-sdk/*` packages on npm.

## Repository layout

| Path | What |
| - | - |
| [`packages/webmcp-sdk`](packages/webmcp-sdk) | the library (`@senon/webmcp-sdk`, entry points `.` and `./react`), its tests, type tests and end-to-end tests |
| [`docs/`](docs) | design notes, research, implementation log; [`docs/release-research/`](docs/release-research) for the release and supply-chain design |
| [`docs/releasing.md`](docs/releasing.md) | how a release is made (maintainers) |
| [`infra/docs`](infra/docs) | infrastructure as code (Alchemy) for the docs site on Cloudflare; runbook: [`docs/docs-deploy.md`](docs/docs-deploy.md) |
| [`tooling/release/`](tooling/release) | release scripts used by `.github/workflows/release.yml` |
| [`.changeset/`](.changeset) | pending change notes (Changesets) |

## Development

Requires Node 24 (`.nvmrc`) and pnpm 10.33 (`packageManager`, via Corepack or `pnpm/action-setup`).

```sh
pnpm install
pnpm exec playwright install chromium   # once, for browser and e2e tests
pnpm test:all                           # typecheck, README/docs snippets, unit, React 18, e2e, packed-tarball and tooling tests
```

Individual suites: `pnpm check`, `pnpm test`, `pnpm test:react18`, `pnpm test:browser`, `pnpm test:e2e`, `pnpm test:package`, `pnpm test:tooling`. Opt-in native WebMCP: `WEBMCP_NATIVE_CHANNEL=chrome pnpm test:e2e:native`.

## Contributing

Pull requests are welcome. If your change affects the published package, add a change note with `pnpm changeset` (pick `patch`/`minor`/`major` and describe the change for the changelog). CI checks this. Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 PaulSenon.
