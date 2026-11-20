// Turns TanStack Start's prerendered client build (dist/client) into the deployable static site
// (out/), and enforces the static output contract documented in apps/docs/README.md.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const app = new URL("..", import.meta.url).pathname;
const client = join(app, "dist/client");
const out = join(app, "out");

if (!existsSync(join(client, "index.html"))) {
  console.error("finalize-out: dist/client/index.html is missing; run `vite build` first.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(client, out, { recursive: true });

// The not-found route is prerendered at /404; static hosts look for /404.html.
renameSync(join(out, "404/index.html"), join(out, "404.html"));
rmSync(join(out, "404"), { recursive: true, force: true });

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(relative(out, path));
  }
};
walk(out);
files.sort();

// Reproducible output: TanStack serializes each route match with its load time (`u:<ms>`) into
// the page. Pin it to SOURCE_DATE_EPOCH, or to the commit time, so two builds of one commit
// produce identical files. The client only uses it to decide staleness, and every loader result
// here is static anyway.
const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH ?? (() => {
  try { return execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: app, encoding: "utf8" }).trim(); }
  catch { return "0"; }
})());
if (!Number.isInteger(epochSeconds)) throw new Error("finalize-out: SOURCE_DATE_EPOCH must be an integer");
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const path = join(out, file);
  const html = readFileSync(path, "utf8");
  const pinned = html.replace(/(\{i:"[^"]*",u:)\d+(,)/g, `$1${epochSeconds * 1000}$2`);
  if (pinned !== html) writeFileSync(path, pinned);
}

const required = ["index.html", "404.html", "docs/index.html", "api/search.json", "sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt"];
const missing = required.filter((f) => !files.includes(f));
if (!files.some((f) => f.startsWith("__tsr/staticServerFnCache/"))) missing.push("__tsr/staticServerFnCache/*.json");
if (missing.length) {
  console.error(`finalize-out: missing from out/: ${missing.join(", ")}`);
  process.exit(1);
}
// Nothing server-side may ship, and no SPA shell: every URL is a prerendered file.
const unexpected = files.filter((f) => /(^|\/)(server|\.tanstack)\//.test(f) || f.endsWith(".map") || f === "_shell.html");
if (unexpected.length) {
  console.error(`finalize-out: unexpected files in out/: ${unexpected.join(", ")}`);
  process.exit(1);
}
console.log(`out/: ${files.length} files, ${files.filter((f) => f.endsWith(".html")).length} HTML pages.`);
