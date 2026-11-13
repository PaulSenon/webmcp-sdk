import { glob } from "node:fs/promises";
import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { docsContentRoute, docsRoute, notFoundRoute, searchIndexRoute } from "./src/lib/routes.ts";

const docsUrl = createGetUrl(docsRoute);
const contentUrl = createGetUrl(docsContentRoute);

/**
 * Every URL of the site, prerendered by TanStack Start (crawling is off: this list is the
 * source of truth). Docs pages are derived from the content files, so a new page is
 * prerendered without touching this list.
 */
export async function prerenderPaths(): Promise<string[]> {
  const paths = new Set(["/", notFoundRoute, searchIndexRoute, "/sitemap.xml", "/robots.txt", "/llms.txt", "/llms-full.txt"]);
  for await (const file of glob("**/*.{md,mdx}", { cwd: "content/docs" })) {
    const slugs = getSlugs(file);
    paths.add(docsUrl(slugs));
    paths.add(contentUrl([...slugs, "content.md"]));
  }
  return [...paths].sort();
}
