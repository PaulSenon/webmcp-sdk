import { createFileRoute } from "@tanstack/react-router";
import { docsLlms, source } from "@/lib/source";

// Markdown version of each page: /llms.mdx/docs/<slugs>/content.md. Prerendered to static files.
export const Route = createFileRoute("/llms.mdx/docs/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = (params._splat ?? "").split("/").filter((v) => v.length > 0);
        slugs.pop(); // the trailing "content.md"
        const page = source.getPage(slugs);
        if (!page) return new Response("not found", { status: 404 });
        return new Response(await docsLlms.page(page), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
      },
    },
  },
});
