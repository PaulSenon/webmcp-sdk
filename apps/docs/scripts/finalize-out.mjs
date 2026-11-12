// Turns React Router's prerendered client build (build/client) into the deployable static site
// (out/), and enforces the static output contract documented in apps/docs/README.md.
import { cpSync, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const app = new URL("..", import.meta.url).pathname;
const client = join(app, "build/client");
const out = join(app, "out");

if (!existsSync(join(client, "index.html"))) {
  console.error("finalize-out: build/client/index.html is missing; run `react-router build` first.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(client, out, { recursive: true });

// The not-found route is prerendered at /404; static hosts look for /404.html.
renameSync(join(out, "404/index.html"), join(out, "404.html"));
rmSync(join(out, "404"), { recursive: true, force: true });
// SPA fallback shell: unused, every URL is prerendered and unknown ones get 404.html.
rmSync(join(out, "__spa-fallback.html"), { force: true });

const list = () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(out, path));
    }
  };
  walk(out);
  return files.sort();
};

// React Router also writes `<path>.data` (client-navigation payload) for resource routes such
// as /sitemap.xml. Nothing navigates to those, so only page payloads (docs.data, docs/x.data) stay.
for (const file of list()) {
  if (file.endsWith(".data") && existsSync(join(out, file.slice(0, -".data".length))) && statSync(join(out, file.slice(0, -".data".length))).isFile()) {
    rmSync(join(out, file));
  }
}
const files = list();

const required = ["index.html", "404.html", "docs/index.html", "api/search.json", "sitemap.xml", "robots.txt", "llms.txt"];
const missing = required.filter((f) => !files.includes(f));
if (missing.length) {
  console.error(`finalize-out: missing from out/: ${missing.join(", ")}`);
  process.exit(1);
}
// Nothing server-side may ship: the host serves files only.
const unexpected = files.filter((f) => /(^|\/)(server|\.react-router)\//.test(f) || f.endsWith(".map"));
if (unexpected.length) {
  console.error(`finalize-out: unexpected files in out/: ${unexpected.join(", ")}`);
  process.exit(1);
}
console.log(`out/: ${files.length} files, ${files.filter((f) => f.endsWith(".html")).length} HTML pages.`);
