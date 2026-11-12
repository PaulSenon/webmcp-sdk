import { index, route, type RouteConfig } from "@react-router/dev/routes";

// Every route is prerendered (react-router.config.ts); there is no server at runtime.
export default [
  index("routes/home.tsx"),
  route("docs/*", "routes/docs.tsx"),
  route("api/search.json", "routes/search.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("robots.txt", "routes/robots.ts"),

  // For LLMs (https://llmstxt.org)
  route("llms.txt", "llms/index.ts"),
  route("llms-full.txt", "llms/full.ts"),
  route("llms.mdx/docs/*", "llms/mdx.ts"),

  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
