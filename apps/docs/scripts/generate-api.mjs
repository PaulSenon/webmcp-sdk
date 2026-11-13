// Generates the API reference pages (content/docs/api/core.md, react.md) from the library's
// TypeScript declarations, so the reference cannot drift from the code.
//
// 1. Emit declarations for packages/webmcp-sdk/src with the repository's TypeScript (into a
//    temporary directory; dist/ is not touched).
// 2. Read the public exports of each entry point. Sections follow the `// Title` comments of
//    src/index.ts; the React entry point is one module.
// 3. For each export: its JSDoc as prose and its declaration as a code block.
//
// Deterministic: same sources -> same bytes. No dependencies beyond tsc. The parser relies on
// tsc's declaration printer (top-level statements start at column 0, members are indented).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const app = new URL("..", import.meta.url).pathname;
const pkg = join(app, "../../packages/webmcp-sdk");
const outDir = join(app, "content/docs/api");
const tsc = join(app, "node_modules/.bin/tsc");

const emitted = mkdtempSync(join(tmpdir(), "webmcp-sdk-api-"));
try {
  execFileSync(tsc, ["-p", join(pkg, "tsconfig.build.json"), "--emitDeclarationOnly", "--outDir", emitted], { stdio: "inherit" });
  const core = coreEntries(emitted);
  const react = reactEntries(emitted);
  const pages = { core: { importPath: "@senon/webmcp-sdk", ...core }, react: { importPath: "@senon/webmcp-sdk/react", ...react } };
  const anchors = new Map(); // export name -> URL
  for (const [page, { sections }] of Object.entries(pages)) {
    for (const s of sections) for (const e of s.exports) anchors.set(e.name, `/docs/api/${page}#${slug(e.name)}`);
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "core.md"), render(pages.core, {
    title: "Core API",
    description: "Every export of @senon/webmcp-sdk, generated from the TypeScript declarations.",
  }, anchors));
  writeFileSync(join(outDir, "react.md"), render(pages.react, {
    title: "React API",
    description: "Every export of @senon/webmcp-sdk/react, generated from the TypeScript declarations.",
  }, anchors));
  writeFileSync(join(outDir, "meta.json"), `${JSON.stringify({ title: "API reference", pages: ["core", "react"] }, null, 2)}\n`);
  const count = [...anchors.keys()].length;
  console.log(`generate-api: ${count} exports documented in content/docs/api/.`);
} finally {
  rmSync(emitted, { recursive: true, force: true });
}

/** src/index.ts groups its re-exports under `// Title` comments; the emitted index.d.ts lists them. */
function coreEntries(dts) {
  const source = readFileSync(join(pkg, "src/index.ts"), "utf8");
  const sections = [];
  let current;
  for (const statement of source.split(/\n(?=\/\/|export )/)) {
    const title = /^\/\/ (.+)/.exec(statement)?.[1];
    if (title) sections.push((current = { title, exports: [] }));
    for (const m of statement.matchAll(/export (?:type )?\{([^}]*)\} from "\.\/([\w-]+)\.js"/g)) {
      const names = m[1].split(",").map((n) => n.trim()).filter(Boolean);
      if (!current) sections.push((current = { title: "Exports", exports: [] }));
      const declarations = statements(readFileSync(join(dts, `${m[2]}.d.ts`), "utf8"));
      for (const name of names) current.exports.push(entry(name, declarations, `${m[2]}.d.ts`));
    }
  }
  return { intro: undefined, sections };
}

/** The React entry point declares everything itself; its module comment is the page intro. */
function reactEntries(dts) {
  const text = readFileSync(join(dts, "react/index.d.ts"), "utf8");
  const intro = /^\/\*\*[\s\S]*?\*\//.exec(text)?.[0];
  const declarations = statements(intro ? text.slice(intro.length) : text);
  const names = [...new Set(declarations.filter((d) => d.exported).map((d) => d.name))];
  const exports = names.map((name) => entry(name, declarations, "react/index.d.ts"));
  return { intro: intro && jsdoc(intro), sections: [{ title: "Exports", exports }] };
}

/** Splits a .d.ts file into top-level statements: { name, exported, doc, code }. */
function statements(text) {
  const lines = text.split("\n");
  const result = [];
  let doc;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("/**")) {
      const start = i;
      while (!lines[i].includes("*/")) i++;
      doc = lines.slice(start, i + 1).join("\n");
      continue;
    }
    if (!line || /^\s/.test(line)) continue;
    const start = i;
    // A statement continues on indented lines and on closing lines such as `}` / `} | {` / `});`.
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || /^[})\]]/.test(lines[i + 1]))) i++;
    const code = lines.slice(start, i + 1).join("\n");
    const m = /^(export )?(?:declare )?(?:abstract )?(?:function|const|let|class|interface|type|enum|namespace) ([\w$]+)/.exec(code);
    if (m) result.push({ name: m[2], exported: Boolean(m[1]), doc, code });
    doc = undefined;
  }
  // Re-exports of imported names: `import type { A } from "pkg"; … export type { A };`
  const imported = new Map();
  for (const m of text.matchAll(/^import (type )?\{([^}]*)\} from "([^"]+)";$/gm)) {
    for (const name of m[2].split(",").map((n) => n.trim()).filter(Boolean)) imported.set(name, { from: m[3], type: Boolean(m[1]) });
  }
  for (const m of text.matchAll(/^export (type )?\{([^}]*)\};$/gm)) {
    for (const name of m[2].split(",").map((n) => n.trim()).filter(Boolean)) {
      const origin = imported.get(name);
      if (!origin || origin.from.startsWith(".")) continue;
      result.push({
        name,
        exported: true,
        doc: `/** Re-exported from \`${origin.from}\`, unchanged. */`,
        code: `export ${m[1] ?? ""}{ ${name} } from "${origin.from}";`,
      });
    }
  }
  return result;
}

function entry(name, declarations, file) {
  const found = declarations.filter((d) => d.name === name);
  if (!found.length) throw new Error(`generate-api: no declaration of ${name} in ${file}`);
  return {
    name,
    kind: /^export (type )?\{/.test(found[0].code) ? "re-export" : kindOf(found[0].code),
    docs: found.map((d) => d.doc && jsdoc(d.doc)).filter(Boolean),
    code: found.map((d) => (/^export (type )?\{/.test(d.code) ? d.code : d.code.replace(/^export /, ""))).join("\n"),
  };
}

function kindOf(code) {
  return /^(?:export )?(?:declare )?(?:abstract )?(function|const|class|interface|type|enum|namespace)/.exec(code)[1];
}

/** JSDoc comment -> Markdown. Handles {@link}, @example, @param, @defaultValue, @deprecated. */
function jsdoc(comment) {
  const body = comment
    .replace(/^\/\*\*\s?/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, ""));
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const tag = /^@(\w+)\s*(.*)$/.exec(line);
    if (!tag) {
      out.push(line.replace(/^(#+) /, "### "));
      continue;
    }
    const [, name, rest] = tag;
    const block = [rest];
    while (i + 1 < body.length && !/^@\w+/.test(body[i + 1])) block.push(body[++i]);
    const text = block.join("\n").trim();
    if (name === "example") out.push("", "Example:", "", "```tsx nocheck", text, "```", "");
    else if (name === "param") out.push(`- Parameter ${text.replace(/^(\w+)\s*-?\s*/, "`$1`: ")}`);
    else if (name === "defaultValue" || name === "default") out.push(`- Default: ${text}`);
    else if (name === "deprecated") out.push(`- **Deprecated.** ${text}`);
    else out.push(`- @${name} ${text}`);
  }
  return out.join("\n").trim();
}

function slug(name) {
  return name.toLowerCase(); // github-slugger on a `code` heading made of \w characters
}

function links(markdown, anchors) {
  return markdown.replace(/\{@link\s+([\w$.]+)(?:\s*\|\s*([^}]+)|\s+([^}]+))?\}/g, (_, target, a, b) => {
    const label = (a ?? b ?? target).trim();
    const url = anchors.get(target.split(".")[0]);
    return url ? `[\`${label}\`](${url})` : `\`${label}\``;
  });
}

function render(page, { title, description }, anchors) {
  const parts = [
    "---",
    `title: ${title}`,
    `description: ${description}`,
    "---",
    "",
    "Generated from the library's TypeScript declarations (`apps/docs/scripts/generate-api.mjs`), so it always matches the code on `main`. Guides explain how the pieces fit together.",
    "",
    "```ts nocheck",
    `import { … } from "${page.importPath}";`,
    "```",
    "",
  ];
  if (page.intro) parts.push("## Overview", "", links(page.intro, anchors), "");
  for (const section of page.sections) {
    const multiple = page.sections.length > 1;
    if (multiple) parts.push(`## ${section.title}`, "");
    for (const e of section.exports) {
      parts.push(`${multiple ? "###" : "##"} \`${e.name}\``, "", `*${e.kind}*`, "");
      for (const d of e.docs) parts.push(links(d, anchors), "");
      parts.push("```ts nocheck", e.code, "```", "");
    }
  }
  return `${parts.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}
