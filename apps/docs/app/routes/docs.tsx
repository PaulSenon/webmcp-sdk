import type { Route } from "./+types/docs";
import { use } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle, MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { docs, source } from "@/lib/source";
import { baseOptions } from "@/lib/layout.shared";
import { useMDXComponents } from "@/components/mdx";
import { PageMeta } from "@/components/page-meta";
import { docsContentRoute } from "@/lib/routes";
import { repoFile } from "@/lib/site";

export async function loader({ params }: Route.LoaderArgs) {
  const slugs = params["*"].split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });
  return {
    path: page.path,
    url: page.url,
    markdownUrl: `${docsContentRoute}/${[...page.slugs, "content.md"].join("/")}`,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
}

// content/docs/api/ is generated from the library's declarations (scripts/generate-api.mjs).
const generatedDir = "api/";
const editUrl = (path: string) =>
  path.startsWith(generatedDir) ? repoFile("packages/webmcp-sdk/src") : repoFile(`apps/docs/content/docs/${path}`);

function Content({ path, url, markdownUrl }: { path: string; url: string; markdownUrl: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);
  const { toc } = use(page.load());
  const Mdx = page.body;

  return (
    <DocsPage toc={toc}>
      <PageMeta title={page.title} description={page.description} path={url} />
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

export default function Page({ loaderData }: Route.ComponentProps) {
  const { pageTree, path, url, markdownUrl } = useFumadocsLoader(loaderData);
  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      <Content path={path} url={url} markdownUrl={markdownUrl} />
    </DocsLayout>
  );
}
