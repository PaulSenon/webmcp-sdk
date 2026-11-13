import { absoluteUrl, site } from "./site";

/** Title, description, canonical URL and Open Graph tags, for a route's `head`. */
export function pageHead({ title, description, path }: { title?: string; description?: string; path: string }) {
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name}: type-safe WebMCP tools for TypeScript`;
  const text = description ?? site.description;
  const url = absoluteUrl(path);
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: text },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: site.name },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: text },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
