// Renders the template's site name ("site") into a repository's own (e.g. "docs"):
//   workflow `site` / `site-deploy`, files site.yml / site-deploy.yml, job `site-build`,
//   environments `site-preview` / `site-production`, artifact `site`, status `site-preview`,
//   vars SITE_DEPLOY_ENABLED / SITE_PREVIEW_MODE / SITE_PREVIEW_DEPENDABOT / SITE_WORKERS_SUBDOMAIN,
//   secret SITE_STATE_TOKEN,
//   delivery.config.json site.name and its `<name>-build` required check.
// Step-level env names read by the infra code (SITE_STATE, SITE_ARTIFACT_DIR…) are NOT renamed.
//   node tooling/rename-site.mjs <name> [--root <dir>]
// Also used by docs/updating.md: render the old and new kit tags with the same name, then diff.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function renameSiteText(text, name) {
  if (!/^[a-z][a-z0-9]{1,15}$/.test(name)) throw new Error("site name must be lowercase letters/digits");
  if (name === "site") return text;
  const UP = name.toUpperCase();
  return text
    .replace(/\bsite-(build|deploy|preview|production)\b/g, `${name}-$1`)
    .replace(/\b(vars|secrets)\.SITE_(DEPLOY_ENABLED|PREVIEW_MODE|PREVIEW_DEPENDABOT|WORKERS_SUBDOMAIN|STATE_TOKEN)\b/g, `$1.${UP}_$2`)
    .replace(/\bSITE_(DEPLOY_ENABLED|PREVIEW_MODE|PREVIEW_DEPENDABOT|WORKERS_SUBDOMAIN)\b/g, `${UP}_$1`) // comments, docs
    .replace(/^(\s*name: )site$/gm, `$1${name}`)
    .replace(/workflows: \[site\]/g, `workflows: [${name}]`)
    .replace(/group: site-\$\{\{/g, `group: ${name}-\${{`)
    .replace(/\bsite\.yml\b/g, `${name}.yml`)
    .replace(/workflow `site`/g, `workflow \`${name}\``);
}

export function renameSiteConfig(config, name) {
  const c = structuredClone(config);
  const old = c.site.name;
  c.site.name = name;
  c.previews.requiredChecks = c.previews.requiredChecks.map((x) => (x === `${old}-build` ? `${name}-build` : x));
  return c;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] ?? "";
  const i = process.argv.indexOf("--root");
  const root = i > 0 ? process.argv[i + 1] : ".";
  const wf = join(root, ".github/workflows");
  for (const [from, to] of [["site.yml", `${name}.yml`], ["site-deploy.yml", `${name}-deploy.yml`]]) {
    const src = join(wf, from);
    if (!existsSync(src)) continue;
    writeFileSync(src, renameSiteText(readFileSync(src, "utf8"), name));
    if (from !== to) renameSync(src, join(wf, to));
  }
  const cfgPath = join(root, "delivery.config.json");
  writeFileSync(cfgPath, `${JSON.stringify(renameSiteConfig(JSON.parse(readFileSync(cfgPath, "utf8")), name), null, 2)}\n`);
  console.log(`site renamed to "${name}": workflows ${name}.yml / ${name}-deploy.yml, environments ${name}-preview / ${name}-production, vars ${name.toUpperCase()}_*`);
}
