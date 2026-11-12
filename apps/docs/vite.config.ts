import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { resolveSiteUrl } from "./site-url.ts";

// The public origin, used for canonical URLs, Open Graph tags, the sitemap and robots.txt.
// Set SITE_URL for deploy builds; the default only suits local builds and checks.
const siteUrl = resolveSiteUrl(process.env.SITE_URL);

export default defineConfig({
  plugins: [fumadocsMdx(), tailwindcss(), reactRouter()],
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  resolve: { alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) } }, // mirrors tsconfig "paths"
});
