// Extracts every ```ts / ```tsx block from the package README.md, the repository docs/*.md (except
// research.md) and the documentation site pages (apps/docs/content/**/*.mdx) into .readme-check/,
// and typechecks them as independent modules against the local sources.
// Blocks fenced as ```ts nocheck are skipped; ```ts file=name.ts gives a block a fixed module name.
// Named modules are shared within a group (the README and docs/*.md form one group, the site pages
// another), so a site page can import `./definitions.js` from another site page.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname; // package root
const repoRoot = join(root, "../..");
const out = join(root, ".readme-check");
rmSync(out, { recursive: true, force: true });

const siteContent = join(repoRoot, "apps/docs/content");
const groups = {
  // docs/research.md quotes third-party snippets verbatim, so it is not checked.
  package: [
    join(root, "README.md"),
    ...readdirSync(join(repoRoot, "docs")).filter((f) => f.endsWith(".md") && f !== "research.md").map((f) => join(repoRoot, "docs", f)),
  ],
  site: existsSync(siteContent)
    ? readdirSync(siteContent, { recursive: true }).filter((f) => f.endsWith(".mdx")).sort().map((f) => join(siteContent, f))
    : [],
};

let count = 0;
for (const [group, files] of Object.entries(groups)) {
  const dir = join(out, group);
  mkdirSync(dir, { recursive: true });
  const named = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Fences may be indented (inside MDX components such as <Tab>).
    const re = /^([ \t]*)```(tsx?)([^\n]*)\n([\s\S]*?)^\1```/gm;
    let m;
    while ((m = re.exec(text))) {
      const [, indent, lang, info, raw] = m;
      if (/\bnocheck\b/.test(info)) continue;
      const body = indent ? raw.split("\n").map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join("\n") : raw;
      const line = text.slice(0, m.index).split("\n").length;
      const where = `${relative(repoRoot, file)}:${line}`;
      // ```ts file=contracts.ts  → written under that name so other blocks of the group can import it.
      const fixed = /\bfile=([\w.-]+)/.exec(info)?.[1];
      if (fixed && named.has(fixed)) {
        console.error(`${where}: file=${fixed} is already defined at ${named.get(fixed)}`);
        process.exit(1);
      }
      if (fixed) named.set(fixed, where);
      const name = fixed ?? `${relative(repoRoot, file).replace(/[^\w]/g, "_")}_L${line}.${lang}`;
      // `export {}` forces module scope so blocks don't leak declarations into each other.
      writeFileSync(join(dir, name), `${body}\nexport {};\n`);
      count++;
    }
  }
}
writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({ extends: "../tsconfig.json", include: ["./*/*.ts", "./*/*.tsx"] }, null, 2),
);
console.log(`Typechecking ${count} code blocks...`);
try {
  execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(out, "tsconfig.json")], { stdio: "inherit" });
  console.log("All README/docs/site code blocks typecheck.");
} catch {
  process.exit(1);
}
