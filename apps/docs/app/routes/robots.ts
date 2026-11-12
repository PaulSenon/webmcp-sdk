import { absoluteUrl } from "@/lib/site";

export function loader() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
