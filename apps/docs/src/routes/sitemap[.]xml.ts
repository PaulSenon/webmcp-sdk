import { createFileRoute } from "@tanstack/react-router";
import { source } from "@/lib/source";
import { absoluteUrl } from "@/lib/site";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Prerendered to a static file.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = ["/", ...source.getPages().map((page) => page.url)].sort();
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escape(absoluteUrl(url))}</loc></url>`).join("\n")}
</urlset>
`;
        return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
      },
    },
  },
});
