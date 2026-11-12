import { Suspense, use } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle, MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { docs, source } from "@/lib/source";
import { baseOptions } from "@/lib/layout.shared";
import { pageHead } from "@/lib/page-head";
import { useMDXComponents } from "@/components/mdx";
import { docsContentRoute } from "@/lib/routes";
import { repoFile } from "@/lib/site";

// Runs only at build time: staticFunctionMiddleware stores each result as a static JSON file
// next to the prerendered page, and client-side navigations fetch that file. No server at runtime.
const loadPage = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .middleware([staticFunctionMiddleware])
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    // A page without a description fails the build (prerendering runs this).
    if (!page.data.description) throw new Error(`content/docs/${page.path}: frontmatter needs a description`);
    return {
      path: page.path,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      markdownUrl: `${docsContentRoute}/${[...page.slugs, "content.md"].join("/")}`,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

export const Route = createFileRoute("/docs/$")({
  loader: async ({ params }) => {
    const slugs = (params._splat ?? "").split("/").filter((v) => v.length > 0);
    // Checked before fetching: an unknown slug has no prerendered payload. This is what renders
    // the not-found page when the host serves 404.html for an unknown /docs/… URL.
    if (!source.getPage(slugs)) throw notFound();
    const data = await loadPage({ data: slugs });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => (loaderData ? pageHead({ title: loaderData.title, description: loaderData.description, path: loaderData.url }) : {}),
  component: Page,
});

// content/docs/api/ is generated from the library's declarations (scripts/generate-api.mjs).
const generatedDir = "api/";
const editUrl = (path: string) =>
  path.startsWith(generatedDir) ? repoFile("packages/webmcp-sdk/src") : repoFile(`apps/docs/content/docs/${path}`);

function Content({ path, markdownUrl }: { path: string; markdownUrl: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);
  const { toc } = use(page.load());
  const Mdx = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="flex flex-row flex-wrap gap-2 items-center border-b -mt-4 pb-6 text-sm">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <a className="text-fd-muted-foreground hover:text-fd-foreground" href={editUrl(path)}>
          {path.startsWith(generatedDir) ? "Source on GitHub" : "Edit on GitHub"}
        </a>
      </div>
      <DocsBody>
        <Mdx components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const { pageTree, path, markdownUrl } = useFumadocsLoader(Route.useLoaderData());
  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      <Suspense>
        <Content path={path} markdownUrl={markdownUrl} />
      </Suspense>
    </DocsLayout>
  );
}
