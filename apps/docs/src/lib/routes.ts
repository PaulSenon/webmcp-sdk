// URL layout of the site. Shared by the routes, the prerender list and the layout.
export const docsRoute = "/docs";
/** Markdown version of each page, for LLMs: /llms.mdx/docs/<slugs>/content.md */
export const docsContentRoute = "/llms.mdx/docs";
/** Static search index (JSON), downloaded by the search dialog on first use. */
export const searchIndexRoute = "/api/search.json";
/** Prerendered once and published as /404.html. */
export const notFoundRoute = "/404";
