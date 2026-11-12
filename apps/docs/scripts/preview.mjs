// Serves out/ locally the way the production host is configured to (Cloudflare Workers static
// assets with html_handling "drop-trailing-slash" and not_found_handling "404-page"):
//   /docs/x  -> docs/x/index.html (or docs/x.html), /docs/x/ -> 308 to /docs/x, unknown -> 404.html
// Dependency-free, for local checks only.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const out = new URL("../out", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4321);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".data": "text/x-script", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** Maps a URL path to a file of out/, or a redirect, or undefined (404). Exported for tests. */
export function resolve(pathname) {
  const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.length > 1 && path.endsWith("/")) return { redirect: path.slice(0, -1) };
  const base = join(out, path);
  for (const candidate of [base, `${base}.html`, join(base, "index.html")]) if (isFile(candidate)) return { file: candidate };
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(out, "index.html"))) {
    console.error("out/ is empty: run `pnpm build` first.");
    process.exit(1);
  }
  createServer((req, res) => {
    const { pathname, search } = new URL(req.url ?? "/", "http://localhost");
    const hit = resolve(pathname);
    if (hit?.redirect) {
      res.writeHead(308, { Location: hit.redirect + search }).end();
      return;
    }
    const file = hit?.file ?? join(out, "404.html");
    res.writeHead(hit ? 200 : 404, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`Serving out/ at http://localhost:${port}`));
}
