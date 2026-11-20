// `pnpm site:build` for the Monorepo Delivery Kit (delivery.config.json site.artifact): builds the
// Fumadocs site (apps/docs, `pnpm docs:build`, output apps/docs/out) and lays it out as the kit's
// artifact: <site.artifact>/assets/** (the kit writes manifest.json next to it).
// Project-owned (not a kit file). SITE_URL is passed through to the site build.
//
// Until apps/docs exists (it lands with PR #6), a noindex placeholder page is used, so CI exercises
// the whole pipeline and production, once enabled, serves a placeholder rather than nothing.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "delivery.config.json"), "utf8"));
const out = resolve(root, config.site.artifact);
if (!out.startsWith(`${root}/`)) throw new Error("site.artifact must stay inside the repository");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (existsSync(join(root, "apps/docs/package.json"))) {
  execFileSync("pnpm", ["docs:build"], { cwd: root, stdio: "inherit", env: process.env });
  cpSync(join(root, "apps/docs/out"), join(out, "assets"), { recursive: true, verbatimSymlinks: true });
  console.log(`docs site laid out in ${config.site.artifact}/assets`);
} else {
  cpSync(join(root, "tooling/docs-placeholder"), join(out, "assets"), { recursive: true });
  console.log(`::notice::apps/docs does not exist yet: ${config.site.artifact}/assets is the placeholder page`);
}
