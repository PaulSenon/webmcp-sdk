// Extracts every ```ts / ```tsx block from README.md (and docs/*.md except research.md) into .readme-check/
// and typechecks them as independent modules against the local sources.
// Blocks fenced as ```ts nocheck are skipped; ```ts file=name.ts gives a block a fixed module name.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, ".readme-check");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// docs/research.md quotes third-party snippets verbatim, so it is not checked.
const files = ["README.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md") && f !== "research.md").map((f) => `docs/${f}`)];
let count = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  const re = /```(tsx?)([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const [, lang, info, body] = m;
    if (info.includes("nocheck")) continue;
    const line = text.slice(0, m.index).split("\n").length;
    // ```ts file=contracts.ts  → written under that name so other blocks can import it.
    const named = /file=([\w.-]+)/.exec(info)?.[1];
    const name = named ?? `${file.replace(/[^\w]/g, "_")}_L${line}.${lang}`;
    // `export {}` forces module scope so blocks don't leak declarations into each other.
    writeFileSync(join(out, name), `${body}\nexport {};\n`);
    count++;
  }
}
writeFileSync(
  join(out, "tsconfig.json"),
  JSON.stringify({ extends: "../tsconfig.json", include: ["./*.ts", "./*.tsx"] }, null, 2),
);
console.log(`Typechecking ${count} code blocks...`);
try {
  execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(out, "tsconfig.json")], { stdio: "inherit" });
  console.log("All README/docs code blocks typecheck.");
} catch {
  process.exit(1);
}
