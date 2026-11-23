import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { prerenderPaths } from "./prerender.ts";
import { resolveSiteUrl } from "./site-url.ts";

// The public origin, used for canonical URLs, Open Graph tags, the sitemap and robots.txt.
// Set SITE_URL for deploy builds; the default only suits local builds and checks.
const siteUrl = resolveSiteUrl(process.env.SITE_URL);

export default defineConfig({
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      // Fully static: every URL is rendered at build time; nothing runs on a server afterwards.
      // The list comes from the content (prerender.ts), not from crawling links.
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false, failOnError: true },
      pages: (await prerenderPaths()).map((path) => ({ path })),
    }),
    react(),
  ],
  define: { __SITE_URL__: JSON.stringify(siteUrl) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, // mirrors tsconfig "paths"
});
