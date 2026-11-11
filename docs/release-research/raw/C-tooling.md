# C — Release, build, documentation and hosting research

Research date: **2026-11-11**. Read-only inspection of the shared worktree; only this file was created. No package installation, generated builds, tests, settings changes, or Git mutations were performed. Registry JSON and official repository/docs were fetched as data, not executed.

Confidence: **H** = directly supported by current primary metadata/documentation; **M** = documented capability whose integration here is untested, or an engineering inference; **L** = unresolved. Undated docs below mean **accessed 2026-11-11**, not a claimed publication date. Versions/dates are the registry's `dist-tags.latest` and `time[version]` unless explicitly identified as GitHub releases. “Recent release” is a maintenance signal, not a support guarantee. Recommendations are judgments, not upstream promises.

## Repository observations and recommendation

Local evidence inspected on 2026-11-11: `package.json`, `tsconfig.json`, `src/index.ts`, `src/react/index.ts`, `scripts/check-readme.mjs`, and README headings.

| Observation | Implication for this repository | Confidence |
|---|---|---|
| `webmcp-sdk@0.0.0-design`, `private:true`, ESM package; exports currently point into `src` | A release needs compiled export targets, an explicit published-file list, and the library made public; keep root/docs private after splitting | H |
| Core and `./react` are subpaths of one package | They share one version and tarball; there is no reason to version React independently yet | H |
| React `>=18` is an optional peer through `peerDependenciesMeta` | Core must load without React; React consumers must install it themselves. Optional does not mean the React entry can run without it | H/M |
| `sideEffects:false`; core exports schemas, registration, discovery, errors | Preserve external dependencies and shared internal identity; don't duplicate core state across independent bundles | H/M |
| TypeScript `^7.0.2`; NodeNext, `.js` relative specifiers, `noEmit:true`, `isolatedModules:true` | Native declaration emit can be a separate build config. `isolatedModules` is **not** `isolatedDeclarations` | H |
| Source `paths` map package imports directly to local `.ts` | Current typechecks can pass while packaged exports fail. Tarball consumers must have no such aliases | H/M |
| README checker extracts README and only immediate `docs/*.md`, skips `research.md`, creates `.readme-check`, invokes `tsc` | Keep this useful mechanism but adapt recursive MD/MDX/site discovery and workspace resolution; it currently won't cover nested site pages | H |
| React entry inspected contains `notImplemented(...)` bodies | Packaging research does not certify React runtime readiness; the release gate must address those stubs | H |

**Recommendation (M):** use Changesets 3 with the v2 action's separate version/pack/publish sub-actions; keep one publishable library and one private docs workspace. Start with native `tsc` producing ESM JS plus unbundled `.d.ts`; adopt tsdown only if compact bundles or its validation/config ergonomics justify the extra moving parts. Use Starlight with the existing independent sample-compilation gate, and defer Twoslash/TypeDoc until their compiler versions are deliberately isolated. Host stable docs on GitHub Pages; choose Netlify instead if fork-PR previews are essential. Every publish should consume the exact tarball tested after versioning.

## 1. Versioning and release tools

### Current versions and maintenance evidence

| Tool | Stable release and date | Primary evidence | Confidence |
|---|---|---|---|
| Changesets CLI | 3.0.3 — 2026-09-14 | [npm registry metadata](https://registry.npmjs.org/@changesets/cli); Node `^22.11 || ^24 || >=26`, pnpm `>=10` | H |
| Changesets Action | **v2.1.2 — 2026-09-07**; avoid copied `@v1` examples | [GitHub release](https://github.com/changesets/action/releases/tag/v2.1.2) | H |
| release-please | 17.11.2 — 2026-08-24 | [registry](https://registry.npmjs.org/release-please) | H |
| release-please-action | v5.0.0 — 2026-04-22, action runtime upgraded to Node 24 | [release](https://github.com/googleapis/release-please-action/releases/tag/v5.0.0) | H |
| semantic-release | 25.0.9 — 2026-08-05; beta 26 exists, not latest | [registry](https://registry.npmjs.org/semantic-release) | H |
| Nx | 24.0.6 — 2026-11-10 | [registry](https://registry.npmjs.org/nx) | H |
| bumpp / changelogithub | 12.3.0 — 2026-09-03 / 15.0.5 — 2026-08-27 | [bumpp registry](https://registry.npmjs.org/bumpp), [changelogithub registry](https://registry.npmjs.org/changelogithub) | H |
| Knope | 0.23.2 — 2026-10-22 | [GitHub release](https://github.com/knope-dev/knope/releases/tag/knope/v0.23.2) | H |
| release-it | 21.1.2 — 2026-10-30 | [registry](https://registry.npmjs.org/release-it) | H |

### Capability and contributor comparison

All operational statements in this table refer to the versions above and linked current upstream docs, accessed 2026-11-11. “Deterministic” assumes the same inputs, configuration and tool versions; timestamps/API-derived contributor names can still vary.

| Tool | Bump/changelog inputs; human trigger | Prereleases, tags, monorepo | Fork-PR experience | Version/publish separation; artifact publishing; retry | Assessment here |
|---|---|---|---|---|---|
| **Changesets** | Reviewed Markdown change files explicitly select package + bump; version PR is the approval surface | `pre enter/exit`; snapshot mode; `publish --tag`; workspace dependency propagation | Contributor adds a text file; no publishing credential required; no commit-title convention needed | Separate `version`/`publish`; action v2 packs tarballs and later consumes artifact ID; CLI skips versions already in registry. Recovery still must reconcile tags/releases | **Best fit** for deliberate API/release notes. Extra per-PR file is the cost. [CLI](https://changesets.dev/guide/cli), [action](https://github.com/changesets/action/tree/v2.1.2) (H/M) |
| **release-please** | Conventional commits -> release PR; maintainer merge decides when | Manifest mode groups configured package paths; `node-workspace` updates local dependencies; prerelease strategy; npm dist-tags belong to publisher | Squash title/merge message needs correct convention; maintainer can fix it. Fork author needs no release token | Does version PRs and GitHub releases, **not npm publishing**; custom npm job can publish saved tarballs. Publish retry must not depend only on one-time `release_created` output | Excellent alternative if conventional squash commits are already mandatory. [manifest/plugin docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md) (H/M) |
| **semantic-release** | Commit analyzer selects bump; release notes from commits; normally runs on release-branch pushes, but workflow can be manually dispatched | Branch/channel model supports beta, next and maintenance; independent multi-package coordination needs extra conventions/plugins | Commit discipline required; squash title can remove burden from contributors | Plugin prepare/publish stages within one run; npm plugin can retain tarball (`tarballDir`) or disable npm publish. Durable separately approved version PR is not its default model; partial failure recovery needs care | More automation than desired. [workflow docs](https://semantic-release.org/foundation/workflow-configuration/), [npm plugin](https://github.com/semantic-release/npm) (H/M) |
| **Nx Release** | Explicit version, conventional commits, or version-plan files; interactive/manual release supported | Fixed/independent groups, prerelease identifiers, npm tags and dependency updates | Plans can be committed in fork PRs without release secrets | `release version`, `release changelog`, `release publish` separated; publish checks registry and skips existing versions; publishing built output is supported, but exact saved-tarball ingestion should be proven | Strong if Nx already manages a larger workspace; disproportionate setup for one SDK + private site. [overview](https://nx.dev/docs/features/manage-releases), [npm behavior](https://nx.dev/docs/kb/release-npm-packages) (H/M) |
| **bumpp + changelogithub** | Maintainer explicitly chooses bump; changelog generated from Git/GitHub history | Prerelease versions possible; recursive JSON version bumps are not a full independent-package dependency graph | No change files; useful commit/PR titles matter | bumpp edits/commits/tags/pushes; publishing is external and can consume tarball. Changelog/release creation and registry retry are your orchestration | Small but loses reviewable per-change semantic intent and integrated recovery. [bumpp](https://github.com/antfu-collective/bumpp), [changelogithub](https://github.com/antfu-collective/changelogithub) (H/M) |
| **Knope** | Change files and/or conventional commits; configured workflows separate prepare/release | Multiple packages and prerelease labels; npm publish/tag via command steps | Changesets-like text files; no publisher credentials needed in PR | `PrepareRelease` versus `Release`/command steps; npm tarball and retry logic are explicit workflow responsibilities | Interesting language-neutral tool, but adds a Rust binary/TOML workflow for an entirely TS workspace. [change sets](https://knope.tech/reference/concepts/changeset/), [prepare](https://knope.tech/reference/config-file/steps/prepare-release/) (H/M) |
| **release-it** | Human prompt/explicit version, optional conventional-changelog plugin, configurable hooks | Prerelease/tag options; monorepo handling via configuration/plugins rather than native Changesets-style planning | No mandatory change files; release notes still need a policy | npm/Git/GitHub operations individually configurable; can disable npm and publish artifact separately. Hook and retry behavior must be designed | Reasonable manual single-package alternative; more bespoke policy than Changesets. [official README](https://github.com/release-it/release-it) (H/M) |

Other current options: **pkg.pr.new** is useful for ephemeral consumer-installable PR artifacts, not a replacement for stable semver/changelog governance; Changesets explicitly links it as a snapshot alternative ([snapshot guide](https://changesets.dev/guide/snapshot-releases), v3.0.3, accessed 2026-11-11, H). Lerna's `publish from-package` can be paired with release-please, but adding it solely to publish one package gives little value over a small artifact publisher (M; example in release-please manifest docs).

### Changesets details that affect the design

| Requirement | Current evidence and consequence | Confidence |
|---|---|---|
| Separate approval/build/publish | v2.1.2 has `version`, `pack`, `publish`, `pr-status`, `pr-comment` sub-actions. [Pack README](https://github.com/changesets/action/blob/v2.1.2/pack/README.md) exposes `pack-dir-artifact-id`; [publish README](https://github.com/changesets/action/blob/v2.1.2/publish/README.md) consumes it. Supports prebuilt tarballs without rebuilding; still requires checkout and installed CLI | H |
| CLI artifact interface | Changesets3 also exposes `changeset pack --out-dir <dir>` and `changeset publish --from-pack-dir <dir>` without requiring the GitHub action. `publish-plan --output` is experimental and must be consumed by the same CLI version. [Current CLI reference](https://changesets.dev/guide/cli), v3.0.3, accessed 2026-11-11 | H |
| OIDC | Action recommends separate sub-actions for trusted publishing. npm requires CLI >=11.5.1 and Node >=22.14, GitHub-hosted runners, `id-token:write`, and package trust configuration. New configurations since 2026-09-03 allow staged publish by default; direct publish and dist-tag permissions are separate choices. [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), [action README](https://github.com/changesets/action/blob/v2.1.2/README.md) | H |
| pnpm publish behavior | CLI detects pnpm and invokes its publisher rather than always npm; it queries existing registry versions. Do not assume npm CLI OIDC requirements alone prove a given pnpm version's OIDC exchange works. Pin and exercise that path, or publish the tarball with supported npm directly. [CLI source documentation](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md), [pnpm publish](https://pnpm.io/cli/publish) | H/M |
| Long-lived prerelease train | `changeset pre enter next`, then normal version/publish; `pre exit`, version, publish for stable. Use a dedicated branch to avoid blocking stable releases; prerelease mode applies to the release set, not an arbitrary isolated subset. [v3 prerelease guide](https://changesets.dev/guide/prereleases) | H |
| Snapshots | `changeset version --snapshot <label>` then publish under an explicit non-latest tag. Default identity includes datetime; save the chosen version or use configured commit identity for repeatability. Do not merge snapshot version mutations into main. [v3 snapshot guide](https://changesets.dev/guide/snapshot-releases) | H |
| New package bootstrap | Official guide currently describes an initial manual/stub publish before configuring trust. Verify npm's current package-creation flow at setup; don't assume an unpublished name already has a configurable trust relationship. [versioning guide](https://changesets.dev/guide/versioning-and-publishing) | H/M |
| Retry/idempotence | Registry skipping is useful but is not a transaction across npm, dist-tags, Git tags and GitHub Releases. A successful npm publish followed by failed release creation can require a distinct repair step, even if the next run finds nothing to publish | M |

**Recommended release contract (M):** maintainer merges version PR -> checkout that exact SHA -> frozen install/check/build -> pack once -> test tarball -> record name/version/SHA/SHA-512 -> approval or explicit manual publish trigger -> npm publish saved tarball -> independently ensure tag, GitHub release and desired dist-tag exist. Keep root and docs `private:true`, exclude docs from package releases, and serialize stable publishes. `changeset git-tag` is available when publishing outside `changeset publish`; use the monorepo package-name tag convention consistently ([CLI docs](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md), accessed 2026-11-11, H).

For retry: query `name@version`; if absent, publish saved artifact; if present, compare registry `dist.integrity` against that artifact and stop on mismatch. Repair tag/release only at the recorded SHA; never move an existing conflicting tag. Fix dist-tags explicitly. npm versions cannot be overwritten; do not “retry” by repacking changed bytes under the same version ([npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish), accessed 2026-11-11, H/M). Treat npm staged publishing as a separate optional approval model, not a required extra layer.

## 2. Build, declarations, ESM and package validation

### Current build choices

| Choice | Stable version/date and evidence | Declaration/compiler implications | Recommendation here / confidence |
|---|---|---|---|
| **Plain native tsc** | TypeScript **7.0.2, 2026-07-08**, [registry](https://registry.npmjs.org/typescript), [7.0 announcement, July 8](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) | Native compiler still exposes `tsc` binary; emits JS/declarations through CLI without old compiler API. Build config must override `noEmit`, set `rootDir:src`, `outDir:dist`, `declaration:true`, and exclude tests/examples | Lowest moving-parts starting point; preserves module graph and comments. More files than bundling; no minification. H/M |
| **tsdown / Rolldown** | **0.23.7, 2026-11-06**, [registry](https://registry.npmjs.org/tsdown), [release history](https://github.com/rolldown/tsdown/releases); pre-1.0 | Uses rolldown-plugin-dts; supports ESM/CJS, multiple entries, external dependencies and validation. Current dts option is `generator`, not old `tsgo:true` | Best bundler candidate if needed; pin exact toolchain, assess minor migrations. H/M |
| **tsup / esbuild** | **9.0.0, 2026-10-14**, [registry](https://registry.npmjs.org/tsup) has **no npm deprecated field** | Official [README](https://github.com/egoist/tsup) still says **not actively maintained**, recommends tsdown; recent publication does not negate that warning. Wide TS peer range is not proof of TS7 compiler-API support | Do not start a new pipeline here. Distinguish maintenance warning from registry deprecation. H |
| **unbuild** | **3.6.1, 2025-08-15**, [registry](https://registry.npmjs.org/unbuild), [official repository](https://github.com/unjs/unbuild) | Rollup-based, declaration generation, unbundled/stub modes; published TypeScript peer is `^5.9.2` | Older release and TS peer mismatch make it less attractive with TS7; not evidence the project is formally abandoned. H/M |
| **bunchee** | **7.0.2, 2026-10-14**, [registry](https://registry.npmjs.org/bunchee), [official README](https://github.com/huozhi/bunchee) | Package-exports-driven bundling; TS peer includes 5/6/7; supports multiple export formats and types | Good low-config alternative; compiler-path compatibility still needs package-specific emit proof. H/M |

### TypeScript 7: the important compatibility boundary

| Tool/path | Current evidence (version/date) | Decision |
|---|---|---|
| TypeScript CLI versus API | `typescript@7.0.2` includes native platform packages and `tsc`; package root exports a version module rather than the legacy full `ts` compiler API ([registry](https://registry.npmjs.org/typescript)). Microsoft states old API tools can run alongside TS6; new API expected with 7.1 ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), 2026-07-08) | CLI declaration emit is viable; importing `typescript` into a legacy plugin is a separate question. H |
| rolldown-plugin-dts | **0.30.1, 2026-11-10**, [registry](https://registry.npmjs.org/rolldown-plugin-dts), [versioned README](https://github.com/sxzz/rolldown-plugin-dts/blob/v0.30.1/README.md): `tsc` generator uses TS5/6; `oxc` uses isolated declarations; `tsgo` uses TS7.1+ API | TS7.0 fallback spawns CLI and is already **deprecated**, promised removal next minor. Pin if using it; do not make a new pipeline depend on that fallback long-term. H |
| Generator auto-selection | Same v0.30.1 README: `isolatedDeclarations` -> Oxc; otherwise TS7 -> tsgo, otherwise tsc | Declare generator deliberately. `isolatedDeclarations` requires explicit export typing and may need source work; it does not replace full typechecking. H/M |
| API Extractor | **7.60.1, 2026-10-30** depends on **TypeScript 6.0.3**, [registry](https://registry.npmjs.org/@microsoft/api-extractor); [purpose](https://api-extractor.com/pages/overview/intro/) is declaration rollup/API reports/docs model | Can analyze TS7-emitted declarations if TS6 can parse/check them; do not override its compiler to TS7. No blanket TS7-source compatibility claim. API snapshots are optional, not necessary to emit declarations. H/M |
| ATTW | **CLI/core 0.18.5, 2026-07-09**; core embeds **TypeScript 5.6.1-rc**, [core metadata](https://registry.npmjs.org/@arethetypeswrong/core) | Its compiler is independent of workspace TS7. Tests resolution/format with its own model; cannot certify TS7 or current Node require(esm) alone. H/M |
| publint | **0.3.25, 2026-10-01**, [registry](https://registry.npmjs.org/publint), [official docs](https://publint.dev/docs/) | Package metadata/entrypoint lint complements type consumer tests; it is not a replacement for them. H/M |

Recommended immediate path: native `tsc` emit and native typecheck, no declaration bundler. If bundled d.ts later becomes useful, first attempt `isolatedDeclarations` + Oxc while retaining full TS7 checks; alternatively consciously adopt TS7.1 when stable and compatible. Avoid upgrading this project to 7.1 beta merely to satisfy an optional bundler/doc plugin (M).

### Node and format policy as of 2026-11-11

| Line | Status on research date | EOL | Primary source / confidence |
|---|---|---|---|
| Node 20 | EOL | 2026-04-30 | [Node Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), retrieved 2026-11-11, H |
| Node 22 | Maintenance LTS | 2027-04-30 | Same schedule, H |
| Node 24 | Maintenance LTS since 2026-10-20 | 2028-04-30 | Same schedule, H |
| Node 26 | Active LTS since 2026-10-28 | 2029-04-30 | Same schedule, H |

Node's [ESM-for-CJS guidance](https://nodejs.github.io/package-examples/04-cjs-esm-interop/shipping-esm-for-cjs/) documents unflagged require(esm) starting at 20.19/22.12 and 24+. [Current Node module docs](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require), v26.13.0 accessed 2026-11-11, require the complete graph to be synchronous (no top-level await). Availability in those older minors must not be confused with every later stability milestone (H).

**Recommend ESM-only (M):** this is a new browser-oriented package already using ESM. Export the same ESM files through a `default` runtime condition so modern CJS callers can use require(esm); test that explicitly. Set supported **tooling** Node floor separately from browser/runtime support; Node26 CI is a current LTS default, with Node22/24 runtime consumers tested if promised. Do not claim compatibility with old Jest/loaders merely because Node can require ESM. Dual ESM/CJS remains defensible if an actual customer requires such tooling; it adds distinct `.d.cts` outputs, conditions and identity/state hazards. `register`/catalog shared state makes that cost especially relevant.

### Proposed published shape (illustrative, not applied)

```json
{
  "name": "webmcp-sdk",
  "type": "module",
  "files": ["dist"],
  "sideEffects": false,
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./react": { "types": "./dist/react/index.d.ts", "default": "./dist/react/index.js" }
  },
  "peerDependencies": { "react": ">=18" },
  "peerDependenciesMeta": { "react": { "optional": true } }
}
```

| Packaging point | Rationale and primary source (accessed 2026-11-11) | Confidence |
|---|---|---|
| `types` first in each export object | Node recommends `types` first; `default` last allows common cross-environment fallback. `.d.ts` is ESM under `type:module`. [Node packages](https://nodejs.org/api/packages.html#conditional-exports) | H |
| Only explicit `.` and `./react` | Stable public API without accidentally exposing internals. React entry must not be re-exported by core, including declarations that cause React type resolution | M |
| Optional peer React | npm documents optional peers via `peerDependenciesMeta`; keep React external, including `react/jsx-runtime` if emitted. [npm package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#peerdependenciesmeta) | H/M |
| Top-level `types` | Helpful fallback for legacy tools for the root; it does not substitute for subpath types conditions. Omit obsolete `module`/UMD output unless a consumer needs it | M |
| `sideEffects:false` | Valid only while imports have no required global registration/polyfill/CSS effects; preserve as an audited assertion. [webpack tree shaking](https://webpack.js.org/guides/tree-shaking/#mark-the-file-as-side-effect-free) | H/M |
| If dual output is added | Nest per-format `types`/runtime conditions; do not point ESM and CJS at one declaration file. [ATTW format explanation](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/docs/problems/FalseESM.md) | H |

Keep `@standard-schema/spec` external as appropriate to actual runtime/type usage; no broad dependency bundling by default. With bundling, use a joint entry graph or deliberate core externalization so `./react` and root do not acquire separate copies of state/error classes. Verify actual output paths; tsdown can choose `.mjs`/`.d.mts`, in which case adjust exports rather than copying this sketch blindly (M).

### Packed-artifact consumer matrix

| Gate | Concrete proposed check | Why it matters |
|---|---|---|
| Pack once | `pnpm --filter webmcp-sdk pack --pack-destination <artifact-dir>` after versioning/build; list tar entries, save hash/manifest | pnpm rewrites workspace dependencies during packing; plain npm packing may differ. [pnpm pack](https://pnpm.io/cli/pack), current pnpm **12.18.0, 2026-11-05**, [registry](https://registry.npmjs.org/pnpm) (H/M) |
| ATTW on that tarball | `attw <file.tgz> --profile esm-only` | ESM-only is explicitly supported. `attw --pack` uses npm, so don't use it to simulate pnpm packing. [CLI README](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/packages/cli/README.md), 0.18.5 (H) |
| Package lint | publint against packed/extracted package contents, using installed version's supported CLI/API | Detect missing targets/types/order/format problems; avoid checking only source manifest (M) |
| Independent fixture | Install tarball outside workspace, no inherited `paths`, no source symlinks; disable lifecycle scripts during consumer install | Reproduces published imports, declarations, files and dependency resolution (M) |
| TS matrix | Proposed supported TS floor e.g. **5.9**, then 6.0 and 7.0.2, under `moduleResolution:bundler` + ESNext and `nodenext` + NodeNext; `skipLibCheck:false` | Published d.ts need not require the compiler used to build it. Choose actual floor based on passing results, not expectation (M) |
| Core without React | Core runtime import and type inference fixture with no React/@types/react installed | Optional peer isolation; don't let devDependencies mask leakage (M) |
| React | Core + React subpath fixtures for supported React18/19 and matching types; JSX consumer and SSR import | Peer range and JSX/runtime compatibility; stubs still need real implementation/tests (M) |
| Runtime | Node22/24/26 import and synchronous require, plus browser bundler build of each subpath | Proves modern require(esm), browser-safe imports and no evaluation-time DOM assumption (M) |
| Type/API tests | Representative inference/generic assertions, known invalid examples, public exports snapshot | ATTW's bundled old compiler cannot prove the SDK's inference semantics or TS7 correctness (M) |

Do not test a tarball then rebuild or repack at publication. Ensure lifecycle hooks (`prepack`, `prepare`, `prepublishOnly`) cannot silently rebuild in the publish step; saved-tarball publication plus appropriately scoped script suppression makes this contract explicit. Cross-check `files` includes required LICENSE/README and any declaration-map referenced sources; maps pointing outside the tarball are not useful (M).

## 3. Co-located documentation site

All version/date cells below are independently fetched npm metadata on 2026-11-11. Framework support is from linked primary docs accessed that date.

| Framework | Current stable version/date | Static output | Versioned docs | Compiled examples and API reference | Fit here / confidence |
|---|---|---|---|---|---|
| **Astro Starlight** | **0.42.10, 2026-11-06**, [registry](https://registry.npmjs.org/@astrojs/starlight); Astro latest **7.4.10, 2026-11-10**, [registry](https://registry.npmjs.org/astro) — choose compatible peers, not independent latest blindly | Astro static output; Markdown/MDX, Pagefind search | Community `starlight-versions`, or separate tag-built directories/deploys | Expressive Code community Twoslash; community `starlight-typedoc` for API pages | **Preferred:** docs-first, little custom UI/runtime. Compiler integrations require isolation; versioning isn't native Docusaurus-style. [plugins](https://starlight.astro.build/resources/plugins/), [content](https://starlight.astro.build/guides/authoring-content/) (H/M) |
| **VitePress** | Stable **1.6.4, 2025-08-05**, next **2.0.0-alpha.21**, [registry](https://registry.npmjs.org/vitepress) | Built static `.vitepress/dist`; configure base for Pages | Usually custom nav + version directories or separate site builds; not a built-in snapshot workflow | Official Shiki VitePress Twoslash; TypeDoc Markdown output via plugins/custom navigation | Strong runner-up, simple Markdown; Vue layer is additional framework knowledge, stable release is older while v2 is alpha. [deploy](https://vitepress.dev/guide/deploy), [Twoslash](https://shiki.style/packages/vitepress) (H/M) |
| **Fumadocs (Next)** | Core **16.18.4, 2026-11-09**, [registry](https://registry.npmjs.org/fumadocs-core); Next **16.4.6, 2026-11-09**, [registry](https://registry.npmjs.org/next) | `output:'export'`; replace live search API with exported/static search; dynamic/server-only features require alternatives | Versioned source/routing conventions; not the same as Docusaurus snapshots | First-party native TS7 Twoslash, type tables; TypeDoc/Markdown possible | Best if rich React interactive docs are a real requirement. More Next/React updates and static-export constraints. [static build](https://www.fumadocs.dev/docs/next/deploying/static), [Twoslash](https://www.fumadocs.dev/docs/markdown/twoslash) (H/M) |
| **Docusaurus** | **3.10.2, 2026-07-10**, [registry](https://registry.npmjs.org/@docusaurus/core) | Native static build | Built-in version CLI/snapshots, `next` and latest routes | TypeDoc and Twoslash through community integrations/custom pipeline | Best built-in versioned manuals; larger plugin/build footprint than this library needs. [versioning](https://docusaurus.io/docs/versioning) explicitly cautions about complexity (H/M) |
| **Nextra** | **4.6.1, 2025-12-04**, [registry](https://registry.npmjs.org/nextra) | Next static exports supported | Custom routes/nav or independent deployments; no verified native snapshot command | Built-in documented Twoslash support; TSDoc components, external TypeDoc pipelines | Attractive React MDX, but brings Next and export/search configuration. [static export](https://nextra.site/docs/guide/static-exports), [Twoslash](https://nextra.site/docs/advanced/twoslash) (H/M) |
| **Mintlify** | CLI **4.3.16, 2026-11-11**, [registry](https://registry.npmjs.org/mintlify); CLI version is not a hosted platform version | Hosted platform; **no verified portable free static-export build** | Built-in version navigation for content maintained in Git | Own components/OpenAPI features; keep independent sample checks in repo | **Not OSS software**; proprietary platform, Markdown content remains yours. Enterprise self-hosting is offered, not a general OSS static host. [official FAQ](https://www.mintlify.com/), [OSS guide](https://www.mintlify.com/library/publish-open-source-local-docs-on-mintlify) (H/M) |

### Twoslash and TypeDoc compiler traps

| Integration | Current package/date and primary evidence | Consequence for TS7 SDK |
|---|---|---|
| Expressive Code Twoslash | Correct package is **`expressive-code-twoslash@0.6.1`, 2026-03-14**, [registry](https://registry.npmjs.org/expressive-code-twoslash), [repository](https://github.com/withstudiocms/expressive-code-twoslash). `@expressive-code/plugin-twoslash` returned registry 404. TS peer `^5.5.0` | Cannot assume TS7 root install works; use a separate compatible TS5 docs compiler or defer hover UI. H/M |
| VitePress Twoslash | `@shikijs/vitepress-twoslash@4.6.0`, **2026-11-02**, [registry](https://registry.npmjs.org/@shikijs/vitepress-twoslash), [integration](https://shiki.style/packages/vitepress); shared `twoslash@0.3.9`, **2026-06-22**, [registry](https://registry.npmjs.org/twoslash), supports TS5.5/6 | Shiki wrapper's wide TS peer does not override narrower transitive compiler compatibility. Pin/isolate TS6 or defer. H/M |
| Fumadocs Twoslash | **4.0.4, 2026-10-23**, [registry](https://registry.npmjs.org/fumadocs-twoslash), depends on **`typescript:7.1.0-beta`**; [current docs](https://www.fumadocs.dev/docs/markdown/twoslash) describe native TS7 | More current native integration, but means a beta compiler for docs, independent of SDK's stable 7.0.2. H/M |
| TypeDoc | **0.28.20, 2026-07-05**, [registry](https://registry.npmjs.org/typedoc); peer supports TS5.0 through **6.0.x**, not TS7 | Separate docs workspace with TS6 is the conservative path if sources are compatible; `skipErrorChecking` does not repair incompatible compiler APIs. H/M |
| starlight-typedoc | **0.23.2, 2026-10-30**, [registry](https://registry.npmjs.org/starlight-typedoc), [upstream](https://github.com/HiDeoo/starlight-typedoc) | Integration exists, but its existence does not establish native TS7 compatibility. H/M |

**Recommendation (M):** private `apps/docs` with `webmcp-sdk:workspace:*`; build library before site. Keep a distinct recursive snippet-check task invoking native TS7 against the built workspace exports. Twoslash is optional hover rendering, not the sole correctness gate; explicitly check TS/TSX blocks without hover annotations too. For release validation, repeat representative docs examples against the tarball with no source aliases. Keep compiler-sensitive docs plugins/TypeDoc on their own supported TS dependency using pnpm workspace isolation, not a root override. Test the JSX sample environment explicitly (React jsx import source versus Astro), rather than inheriting the site framework's compiler settings.

Start with curated reference pages for the two entrypoints. Add TypeDoc once it improves maintenance enough to justify a second compiler. Generate API reference from **the same release tag** as the prose and show package version/SHA in footer. Do not inject main's generated API into stable docs (M).

## 4. Static hosting and preview deployments

### Hosting comparison

Plan figures are **as observed 2026-11-11**, not permanence guarantees or an assurance of OSS-program approval. Pricing plans differ for legacy accounts.

| Host | Relevant free limits / OSS | Deploy auth and previews | Fork PR behavior / secret exposure | Rollback | Fit / confidence |
|---|---|---|---|---|---|
| **GitHub Pages** | Public repos on Free; site <=1GB, soft 100GB/month bandwidth; 10-minute deployment timeout; custom Actions builds exempt from 10-build/hour cap. [limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) | Actions artifact -> `actions/deploy-pages`; **v5.0.1, 2026-09-01**, [release](https://github.com/actions/deploy-pages/releases/tag/v5.0.1). `pages:write`, `id-token:write`, deployment environment | **No native per-PR preview hosting**. Fork CI can build/test without secrets; do not deploy unreviewed fork code in privileged jobs | Redeploy retained known-good artifact or rebuild recorded tag; no equivalent multi-deployment instant alias switch documented | Lowest account/credential overhead; best if CI artifacts/local preview suffice. [workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) (H/M) |
| **Cloudflare Pages** | Free 500 builds/month, one concurrent, 20-minute build timeout; static hosting. [limits](https://developers.cloudflare.com/pages/platform/limits/) updated 2026-09-05 | GitHub App branch previews; Direct Upload via CI API token | **Fork PR preview URLs are not created** in native GitHub integration; same-repo branch previews do work. [GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/), updated 2026-11-10 | Select prior successful production deployment; previews are not direct rollback targets. [rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/) | Existing users can keep it, but don't choose on assumption of automatic fork previews. H/M |
| **Cloudflare Workers Static Assets** | Static asset requests free/unlimited, no asset storage charge; invoking Worker follows Workers billing. [billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | Workers Builds GitHub integration or Wrangler Actions/API token; preview system exists, but fork-specific automation/parity needs proof | Avoid promising Pages-like or Netlify-like fork behavior. Scoped preview builds must have no production secrets/bindings; exact fork authorization not verified | Version/deployment rollback; asset version travels with deployment. [rollback](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) | Cloudflare's **recommended new-project path**, even for static-only with no script. H/M |
| **Netlify** | New Free plan **300 credits/month**. OSS program: **10,000/month, free production deploys, unlimited team members, sites stay live if credits exhausted**, by application. [pricing](https://www.netlify.com/pricing/), [OSS](https://www.netlify.com/open-source/) | GitHub integration automatically builds previews; CLI can deploy prebuilt dir via `NETLIFY_AUTH_TOKEN`/site ID | Untrusted forks require approval by default. Can opt into **build without sensitive variables** or unrestricted mode. Variables must actually be classified/scoped appropriately. [deploy policy](https://docs.netlify.com/deploy/deploy-overview/) | Republish a retained deploy; immutable deploy permalinks. [deploys](https://docs.netlify.com/deploy/deploy-types/deploy-previews/) | **Best preview-first option** here; credit accounting or OSS approval is the trade-off. H/M |
| **Vercel** | Hobby includes **100GB fast data transfer, 10GB origin transfer, 1M CDN requests**; **100 deployments/day**, per current [Hobby](https://vercel.com/docs/plans/hobby)/[limits](https://vercel.com/docs/limits). Personal/noncommercial scope; OSS program application available | GitHub App automatic previews; Actions `vercel build` + `deploy --prebuilt` supports built artifact, normally `VERCEL_TOKEN` | **Git Fork Protection requires team authorization** to deploy a fork; protects environment variables **and OIDC token**. Approval executes that code with configured access. [security settings](https://vercel.com/docs/project-configuration/security-settings) | Promote retained deployment / Instant Rollback subject to plan/retention. [Git integration](https://vercel.com/docs/git/vercel-for-github) | Natural with Next-based docs; little advantage for plain static Starlight, plus contributor/plan rules. H/M |

Cloudflare's [current best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#use-workers-static-assets-for-new-projects), accessed 2026-11-11, explicitly prioritize Workers for new projects while Pages continues working. **Do not conflate Pages with deprecated Workers Sites**: the old KV-based Workers Sites is deprecated in Wrangler4 ([official notice](https://developers.cloudflare.com/workers/configuration/sites/), updated 2026-04-23). No Pages shutdown date was verified (H).

Netlify's current credit rates are **15/production deploy, 0/preview or branch deploy, 20/GB bandwidth, 2/10,000 web requests** ([credit docs](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), accessed 2026-11-11, H). Thus “free previews” means deployment charge, not unlimited preview traffic; the OSS plan removes production-deploy charges. Old claims about 100GB bandwidth/300 build minutes do not describe a newly created credit-based Free account.

### OIDC distinctions and safe fork flow

| Host/path | Verified state on 2026-11-11 | Confidence |
|---|---|---|
| Pages deploy | Native GitHub OIDC used by deploy-pages; environment can restrict deployment branches/approval. No extra third-party API token | H |
| Cloudflare Actions | [Official Workers Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) uses scoped `CLOUDFLARE_API_TOKEN` and account ID. Generic tokenless GitHub-OIDC static deployment was not verified | H/L |
| Netlify Actions | [Official CLI guide](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/) documents auth token. Generic GitHub-OIDC deployment login was not verified | H/L |
| Vercel Actions | [Official guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel) documents token-based prebuilt deployment. [Vercel OIDC](https://vercel.com/docs/oidc) is chiefly Vercel workload -> backend federation, not proof of tokenless static-site deployment from GitHub | H/M |
| New Vercel registry login | [October 2026 VCR action](https://vercel.com/changelog/vcr-login-github-action) exchanges GitHub OIDC for container-registry login; do not extrapolate that to static deploy CLI | H |

Recommended fork flow (M): unprivileged `pull_request` builds/typechecks docs using only public workspace dependencies; no publisher token, npm OIDC permission, or production settings. Native hosting integration handles preview approval, preferably without sensitive variables. A privileged `pull_request_target` workflow must not check out and run the fork's scripts. If using a two-workflow artifact upload, validate run origin/SHA and deploy inert prebuilt static files without executing artifact scripts. Hosting credentials are still deployment authority even if the docs do not otherwise need secrets.

### Versioned documentation policy

| Approach | Benefit | Cost / recommendation |
|---|---|---|
| Stable built from release tag; main shown as `next` | Accurate install instructions and APIs; release can link immutable docs | **Preferred**. Root points to latest stable; `/next/` or separate host visibly identifies unreleased state. Record tag + resolved SHA in build manifest |
| Immutable `/v/<version>/` or version subdomains | Durable links for older users | Keep at least active majors; every patch archive increases files/build/search complexity. Retain rendered artifacts to avoid rebuilding old toolchains |
| Docusaurus snapshots | Built-in version switching, one site build | Copies content and increases contributor/build work; justified when multiple maintained majors actually exist |
| Only main docs | Simplest operation | Risk of publishing unreleased APIs. Acceptable before first release with a prominent unreleased label; not the preferred stable policy |

These are design recommendations (M), not automatic features of every host. On Pages, uploading a new artifact replaces the site: compose stable/next/archive content into one deployment or choose separate repositories/sites. On any host, retain exact built outputs with provenance; rollback docs independently from npm. Documentation corrections may warrant a release-branch docs deploy without a new npm version, but identify its SHA separately from the package tag (M).

## 5. Deterministic changelog and release identity

| Input/model | Determinism and review | Contributor trade-off | Recommendation here |
|---|---|---|---|
| **Changeset files** | Package, bump and prose are version-controlled; version PR can be reviewed before registry side effects. Pin formatter/changelog package; GitHub enrichment can change external metadata | One extra file per user-visible change; maintainer may write it for drive-by forks | **Preferred**. Require release notes for API/behavior changes, allow explicitly justified empty/no-release changes (M; [Changesets rationale](https://changesets.dev/guide/why), v3 docs) |
| Conventional commits | Same commit range/parser rules gives same bump; squash-title edits determine result, scope alone isn't sufficient package-release policy | Less file friction, but title/commit discipline and maintainer responsibility | Good release-please alternative; preserve final merge messages and pin parser config (M; [release-please](https://github.com/googleapis/release-please)) |
| GitHub auto-generated notes | PR/contributor list and full compare link; label/category configuration available. Not a semantic-version oracle; labels/user metadata are mutable | Almost no contributor process, but weak explanation of API implications | Use as supplementary “all PRs” appendix, not canonical changelog. [GitHub docs](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes), accessed 2026-11-11 (H/M) |
| Maintainer-written notes | Highest editorial control, but depends on memory unless tied to reviewed changes | Work concentrated at release time | Edit generated version PR notes for clarity; don't regenerate different prose after publish (M) |

Recommended identity contract (M): committed changelog heading includes package/version; GitHub release body copies the approved entry, links **previous tag...current tag** and **full release SHA**; tag resolves to the commit whose manifest version was packed. Attach the tested `.tgz` and checksum/release manifest where appropriate; record docs build SHA too. If prose later needs correction, update notes without retagging source or pretending package bytes changed.

Pin release tools and lockfile, normalize ordering, and distinguish semantic determinism from byte reproducibility. Timestamp-based snapshot versions are intentionally time-dependent; external author/avatar/name lookups are mutable. A saved artifact plus recorded integrity makes retry deterministic even if rebuilding historical source would differ. Ensure workflows created with `GITHUB_TOKEN` do not rely on automatically triggering follow-up workflows from bot commits/tags; use an explicit same-workflow continuation, supported dispatch, or deliberate GitHub App design ([GitHub triggering rules](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow), accessed 2026-11-11, H/M).

## Open / unverifiable items

| Item | What remains to prove before implementation | Confidence |
|---|---|---|
| Package name / first publish | Availability/ownership and initial trusted-publisher bootstrap; no publishing permissions were inspected | L |
| pnpm OIDC with Changesets3 | Pin actual pnpm/npm versions and run an authorized test publish. Current pnpm docs establish tarball publishing and registry skipping, but do not by themselves prove OIDC behavior for the selected path | L |
| Action artifact retry | v2.1.2 documents pack/publish artifacts; cross-run retention/download, integrity verification, dist-tag repair, and GitHub release repair need an implementation test. Native “already published” skipping isn't a complete recovery protocol | M/L |
| TS7 declaration output | No source build was run. Native tsc config, declaration privacy, generic inference, and React declaration isolation still need tarball fixture proof | L |
| TS7 consumer floor | 5.9/6/7 matrix is proposed; actual minimum supported consumer TypeScript and React types must come from results | L |
| Declaration bundler future | v0.30.1 says TS7.0 backend removal next minor; exact subsequent release date unknown. TS7.1 is beta in current metadata | H/L |
| Docs compiler integrations | TypeDoc/Expressive Code Twoslash compatibility under isolated TS5/6 is plausible, not executed. Fumadocs' beta TS7.1 toolchain is published but not assessed against this repo | M/L |
| Framework versions | Latest Astro/Next may not match latest docs framework peers; resolve documented peer ranges under chosen lockfile. Maintenance health beyond release timestamps/README statements was not audited | M/L |
| Fumadocs/Nextra version lifecycle | No equivalent to Docusaurus's turnkey version snapshot workflow was verified; use explicit version routing/builds or investigate further | L |
| Hosting fork parity | Pages explicitly excludes fork previews; Workers Builds fork automation and build-secret scoping need a concrete product test. Do not claim Cloudflare handles forks automatically | H/L |
| Hosting OIDC | Tokenless general static deployment to Cloudflare/Netlify/Vercel was not verified; supported documented token paths are reported rather than claiming categorical lack of OIDC | L |
| Hosting plans and retention | Free-tier quotas, credit schedules, archive retention and OSS eligibility can change; verify the actual account/project plan before choosing. No account settings inspected | M/L |
| React readiness | Inspected entrypoint is stubbed; other agents may change it. This report is a point-in-time research artifact, not release approval | H |

No benchmark, deployment, install or untrusted package execution was used to manufacture certainty. All proposed operational checks above are future implementation gates.
