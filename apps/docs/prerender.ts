import { glob } from "node:fs/promises";
import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { docsContentRoute, docsRoute, notFoundRoute } from "./app/lib/routes.ts";

const docsUrl = createGetUrl(docsRoute);
const contentUrl = createGetUrl(docsContentRoute);

/**
 * Every URL of the site. Static routes come from React Router; docs pages are derived from the
 * content files, so a new .mdx file is prerendered without touching this list.
 */
export async function prerenderPaths(staticPaths: string[]): Promise<string[]> {
  const paths = new Set(staticPaths);
  paths.add(notFoundRoute); // becomes out/404.html
  for await (const file of glob("**/*.mdx", { cwd: "content/docs" })) {
    const slugs = getSlugs(file);
    paths.add(docsUrl(slugs));
    paths.add(contentUrl([...slugs, "content.md"]));
  }
  return [...paths].sort();
}
