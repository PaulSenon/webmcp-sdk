import { absoluteUrl, site } from "@/lib/site";

/** Title, description, canonical URL and Open Graph tags. React hoists them into <head>. */
export function PageMeta({ title, description, path }: { title?: string; description?: string; path: string }) {
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name}: type-safe WebMCP tools for TypeScript`;
  const text = description ?? site.description;
  const url = absoluteUrl(path);
  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={text} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={site.name} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={text} />
      <meta property="og:url" content={url} />
      <meta name="twitter:card" content="summary" />
    </>
  );
}
