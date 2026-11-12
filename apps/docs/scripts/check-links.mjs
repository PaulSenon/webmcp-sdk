// Validates the built site (out/) offline:
// - every internal href/src resolves to a file, the way the host serves it (see preview.mjs);
// - every #fragment exists as an id in the target page;
// - links to this repository on GitHub (blob/tree at main) point to paths that exist here;
// - every page has a title, a description and a canonical URL; 404.html is noindex.
// External links are not fetched: the check is deterministic and needs no network.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolve } from "./preview.mjs";

const app = new URL("..", import.meta.url).pathname;
const out = join(app, "out");
const repoRoot = join(app, "../..");
const repoPrefix = "https://github.com/PaulSenon/webmcp-sdk/";
// Paths that exist only after the first release (written by `changeset version`).
const futureRepoPaths = new Set(["packages/webmcp-sdk/CHANGELOG.md"]);

if (!existsSync(join(out, "index.html"))) {
  console.error("check-links: out/ is empty; run `pnpm build` first.");
  process.exit(1);
}

const htmlFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".html")) htmlFiles.push(path);
  }
};
walk(out);

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) idsCache.set(file, new Set([...readFileSync(file, "utf8").matchAll(/\sid="([^"]*)"/g)].map((m) => decode(m[1]))));
  return idsCache.get(file);
};

const errors = [];
let checked = 0;
for (const file of htmlFiles.sort()) {
  const page = relative(out, file);
  const html = readFileSync(file, "utf8");

  for (const [tag, pattern] of [["title", /<title>[^<]+<\/title>/], ["description", /<meta name="description" content="[^"]+"/]]) {
    if (!pattern.test(html)) errors.push(`${page}: missing ${tag}`);
  }
  if (page === "404.html") {
    if (!html.includes('<meta name="robots" content="noindex"')) errors.push("404.html: missing noindex");
  } else if (!/<link rel="canonical" href="[^"]+"/.test(html)) {
    errors.push(`${page}: missing canonical URL`);
  }

  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const url = decode(m[1]);
    checked++;
    if (url.startsWith(repoPrefix)) {
      const repoPath = /^(?:blob|tree)\/main\/(.+)$/.exec(url.slice(repoPrefix.length).split("#")[0])?.[1];
      if (repoPath && !futureRepoPaths.has(repoPath) && !existsSync(join(repoRoot, decodeURIComponent(repoPath)))) {
        errors.push(`${page}: ${url} -> no such path in the repository`);
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) continue; // external: not fetched
    if (!url.startsWith("/") && !url.startsWith("#")) {
      errors.push(`${page}: relative link ${url} (use a root-relative path)`);
      continue;
    }
    const [path, fragment] = url.split("#");
    const target = path ? resolve(path.split("?")[0]) : { file };
    if (!target?.file) {
      errors.push(`${page}: ${url} -> ${target?.redirect ? `redirects to ${target.redirect}` : "not found"}`);
      continue;
    }
    if (fragment && target.file.endsWith(".html") && !idsOf(target.file).has(decodeURIComponent(fragment))) {
      errors.push(`${page}: ${url} -> no element with id "${fragment}"`);
    }
  }
}

// Every URL in the sitemap (built from the Fumadocs source) must be a prerendered file: no page
// relies on crawling or on a client-side fallback.
const sitemap = readFileSync(join(out, "sitemap.xml"), "utf8");
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(decode(m[1])).pathname);
for (const path of sitemapUrls) {
  const target = resolve(path);
  if (!target?.file?.endsWith(".html")) errors.push(`sitemap.xml: ${path} is not a prerendered page`);
}
if (sitemapUrls.length !== htmlFiles.length - 1) {
  errors.push(`sitemap.xml lists ${sitemapUrls.length} URLs, out/ has ${htmlFiles.length - 1} pages besides 404.html`);
}

if (errors.length) {
  console.error(`check-links: ${errors.length} problem(s):\n${errors.map((e) => `  ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`check-links: ${htmlFiles.length} pages, ${checked} links and assets, ${sitemapUrls.length} sitemap URLs OK.`);
