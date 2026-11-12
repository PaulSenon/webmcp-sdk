declare const __SITE_URL__: string; // vite.config.ts `define`, validated by site-url.ts

export const site = {
  name: "webmcp-sdk",
  description:
    "Type-safe WebMCP tools for TypeScript: define tools with Standard Schema, implement them with inferred types, register them with validation and agent-readable errors.",
  url: __SITE_URL__,
  packageName: "@senon/webmcp-sdk",
  /**
   * Shows the "not published yet" banner (owner decision D8). Set to `true` in the PR that
   * follows the first npm release of @senon/webmcp-sdk.
   */
  published: false,
  github: { owner: "PaulSenon", repo: "webmcp-sdk", branch: "main" },
} as const;

export const repoUrl = `https://github.com/${site.github.owner}/${site.github.repo}`;
/** A file of the repository on GitHub, at the default branch. */
export const repoFile = (path: string) => `${repoUrl}/blob/${site.github.branch}/${path}`;
export const absoluteUrl = (path: string) => new URL(path, site.url).href;
