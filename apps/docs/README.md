# Documentation site (`@senon/webmcp-sdk-docs`)

The public documentation of [`@senon/webmcp-sdk`](../../packages/webmcp-sdk). Private workspace package, never published. A **fully static** site: prerendered HTML, assets, and a static search index, so any static host can serve it, with no server runtime.

```sh
pnpm docs:dev      # dev server with hot reload (http://localhost:5173)
pnpm docs:build    # static site in apps/docs/out
pnpm docs:check    # typecheck + code blocks + build + link check (what CI runs)
pnpm docs:test     # browser smoke tests of out/ (after a build; needs `playwright install chromium`)
pnpm --filter @senon/webmcp-sdk-docs preview   # serve out/ like production, http://localhost:4321
```

## Stack and why

| | |
| - | - |
| Docs framework | [Fumadocs](https://fumadocs.dev) 16 (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`) |
| App framework | React Router 8 in framework mode with `ssr: false` + `prerender` (Fumadocs' official React Router integration) |
| Build | Vite 7, Tailwind CSS 4, TypeScript 7 (the repository's native compiler) |

Fumadocs needs a React framework underneath. It supports Next.js, React Router, TanStack Start and Waku. **React Router with prerendering** gives the cleanest static output here:

- **Static by construction.** `ssr: false` + `prerender` writes one HTML file per URL plus a `.data` payload for client-side navigation. The list of URLs comes from the content files ([`prerender.ts`](prerender.ts)), not from a crawler, so it is exact.
- **Same toolchain as the library.** Vite (the version the library's tests use) and TypeScript 7 native. Next.js would need the classic TypeScript compiler API, which TS 7 no longer has (so a second TypeScript 6 just for the docs). It would also bring native SWC/sharp binaries into the build, a larger surface for threat T17 (docs build compromise, see `docs/release-research/02-threat-model.md`).
- **TanStack Start** also works with Fumadocs, but it is younger and releases very often, and its static mode crawls links. It was not needed.

Not used, on purpose: generated Open Graph images (they need a native image renderer in the build), web fonts from third-party CDNs, analytics. The site loads no third-party script.

## Structure

```
apps/docs/
├── content/docs/          # pages (.mdx) and navigation (meta.json): the content
│   └── api/               # GENERATED (gitignored): API reference, see below
├── app/
│   ├── routes.ts          # every URL of the site
│   ├── root.tsx           # HTML shell, search dialog, "not published yet" banner
│   ├── routes/            # home, docs pages, 404, search index, sitemap.xml, robots.txt
│   ├── llms/              # llms.txt, llms-full.txt, Markdown version of each page
│   ├── components/        # MDX components, search dialog, <head> metadata, banner
│   └── lib/               # site constants (site.ts), routes, Fumadocs source
├── scripts/
│   ├── generate-api.mjs   # API reference from the library's declarations
│   ├── finalize-out.mjs   # build/client -> out/, enforces the output contract
│   ├── check-links.mjs    # offline link/anchor/metadata check of out/
│   └── preview.mjs        # local static server with the production host's rules
├── e2e/site.spec.ts       # Playwright smoke tests of out/
├── prerender.ts           # list of URLs to prerender
├── site-url.ts            # SITE_URL validation
├── react-router.config.ts
└── vite.config.ts
```

## Adding or changing a page

1. Create `content/docs/<slug>.mdx` with a `title` and a `description` in the frontmatter (the build fails without a description):
   ```mdx
   ---
   title: My page
   description: One sentence, shown under the title, in search results and in link previews.
   ---
   ```
2. Add `<slug>` to `content/docs/meta.json`, where it should appear in the sidebar.
3. `pnpm docs:dev` to see it, then `pnpm docs:check`.

Rules for content:

- **The package README is the source of truth.** Pages restate it, organised for a website. Do not document an API, option or behaviour the README and the code do not have. When the README changes, update the matching page in the same PR.
- **Every ` ```ts ` / ` ```tsx ` block is typechecked** against the library's sources by [`packages/webmcp-sdk/scripts/check-readme.mjs`](../../packages/webmcp-sdk/scripts/check-readme.mjs), the same checker as the README's. The conventions are the same: ` ```ts nocheck ` skips a block (pseudo-code, a polyfill import); ` ```ts file=name.ts ` makes a block importable by other blocks as `./name.js`. Site pages share one module group (`definitions.ts`, `tools.ts`, `shop-*.ts` are defined once); the README has its own. `title="…"` is only the label shown above the block.
- **Links:** use root-relative paths with the page, also for anchors on the same page (`/docs/errors#unexpected-errors`, not `#unexpected-errors`), and GitHub URLs (`https://github.com/PaulSenon/webmcp-sdk/blob/main/…`) for repository files. `check-links` verifies both, offline.
- **Internal notes stay internal:** `docs/design.md`, research and release-research notes are not site pages. Link to them on GitHub when a reader needs them.
- MDX components available without import: Fumadocs defaults (`Callout`, `Cards`/`Card`, code blocks with tabs, ` ```npm ` install tabs…) plus `Tabs`/`Tab` and `Steps`/`Step` (see [`app/components/mdx.tsx`](app/components/mdx.tsx)).

## API reference

`content/docs/api/{core,react}.md` are generated by [`scripts/generate-api.mjs`](scripts/generate-api.mjs) before `dev` and `build`:

1. it emits the library's declarations with the repository's `tsc` into a temporary directory;
2. it lists the public exports of `.` (grouped like the `// Section` comments of `src/index.ts`) and `./react`;
3. it renders each export's JSDoc (with `{@link}` resolved to anchors) and its declaration.

The output is deterministic and not committed: the reference cannot drift from the code, and package PRs do not need to regenerate anything. Fumadocs' own `fumadocs-typescript` was not used: it depends on a TypeScript 7.1 beta with platform binaries.

## Static output contract

`pnpm docs:build` produces **`apps/docs/out/`**, to be served at the **root path `/`** (no base path). [`scripts/finalize-out.mjs`](scripts/finalize-out.mjs) fails the build if a required file is missing or a server file slipped in.

| path | what |
| - | - |
| `index.html`, `docs/**/index.html` | one prerendered page per URL (`/docs/react` → `docs/react/index.html`) |
| `docs.data`, `docs/**.data` | payloads fetched by client-side navigation (`/docs/react` → `docs/react.data`) |
| `404.html` | the not-found page (`noindex`) |
| `assets/` | hashed JS/CSS: immutable, cacheable forever |
| `api/search.json` | static search index, downloaded by the search dialog on first use |
| `sitemap.xml`, `robots.txt` | with absolute URLs from `SITE_URL` |
| `llms.txt`, `llms-full.txt`, `llms.mdx/docs/**/content.md` | the docs as Markdown, for LLMs |
| `icon.svg` | favicon |

**Host configuration expected** (what [`scripts/preview.mjs`](scripts/preview.mjs) emulates and the smoke tests verify). For Cloudflare Workers static assets:

- `html_handling: "drop-trailing-slash"`: `/docs/react` serves `docs/react/index.html`, and `/docs/react/` redirects to it. Links on the site never have a trailing slash.
- `not_found_handling: "404-page"`: unknown URLs get `404.html` with status 404.
- Long cache for `/assets/*`; short cache (or revalidation) for everything else.

**Environment:**

| variable | used for | default |
| - | - | - |
| `SITE_URL` | canonical URLs, Open Graph `og:url`, `sitemap.xml`, `robots.txt` | `http://localhost:4321` (local builds only) |

`SITE_URL` must be a bare `http(s)` origin (`https://docs.example.com`); anything with a path, query or fragment fails the build. **Deploy builds must set it.** The build needs no secrets and no network beyond `pnpm install`.

## Before and after the first release

Until `@senon/webmcp-sdk` is on npm, every page shows a "not published yet" banner (owner decision D8). After the first release, set `published: true` in [`app/lib/site.ts`](app/lib/site.ts), and update `installation.mdx` (drop the pre-release section) and `changelog.mdx`.

## Licence

MIT © 2026 PaulSenon.
