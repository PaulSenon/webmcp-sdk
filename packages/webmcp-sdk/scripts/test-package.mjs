// Tests the package as consumers get it: build, pack ONE tarball, lint it, then install it
// into throwaway consumer projects (no workspace links, no `paths`) and typecheck + import it.
//
// Usage: node scripts/test-package.mjs [--out <dir>] [--no-build]
//   --out <dir>   keep the tarball as <dir>/pkg.tgz (used by the release workflow)
//   --no-build    reuse an existing dist/ (CI builds once before)
//
// Offline by design: consumer node_modules are assembled from the tarball plus the
// workspace's already-installed dependencies (symlinked), so nothing is fetched.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = realpathSync(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
const bin = (name) => join(root, "node_modules/.bin", name);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: "inherit", ...opts });
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// realpath of a direct dependency of this package (pnpm layout), so its own dependencies resolve too
const resolveDep = (name) => realpathSync(join(root, "node_modules", name));

const work = mkdtempSync(join(tmpdir(), "webmcp-sdk-pkg-"));
try {
  if (!args.includes("--no-build")) run("node", [join(root, "scripts/build.mjs")]);

  // 1. Pack exactly once.
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  run("pnpm", ["pack", "--pack-destination", packDir], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  const [tgzName] = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  if (!tgzName) throw new Error("pnpm pack produced no tarball");
  const tgz = join(packDir, "pkg.tgz");
  renameSync(join(packDir, tgzName), tgz);

  // 2. Contents allowlist and manifest checks.
  const entries = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split("\n");
  const allowed = /^package\/(package\.json|README\.md|LICENSE|CHANGELOG\.md|dist\/.+\.(js|d\.ts))$/;
  const unexpected = entries.filter((e) => !allowed.test(e));
  if (unexpected.length) throw new Error(`unexpected files in tarball:\n${unexpected.join("\n")}`);
  for (const required of ["package/package.json", "package/README.md", "package/LICENSE", "package/dist/index.js", "package/dist/index.d.ts", "package/dist/react/index.js", "package/dist/react/index.d.ts"]) {
    if (!entries.includes(required)) throw new Error(`missing from tarball: ${required}`);
  }
  const packed = JSON.parse(execFileSync("tar", ["-xOzf", tgz, "package/package.json"], { encoding: "utf8" }));
  if (packed.name !== manifest.name || packed.version !== manifest.version) throw new Error("packed name/version mismatch");
  const specifiers = JSON.stringify([packed.dependencies, packed.peerDependencies, packed.optionalDependencies]);
  if (/workspace:|catalog:|link:|file:/.test(specifiers)) throw new Error("packed manifest contains workspace/local specifiers");
  const publishConfigKeys = Object.keys(packed.publishConfig ?? {});
  if (publishConfigKeys.some((k) => k !== "access")) throw new Error(`publishConfig may only contain "access": ${publishConfigKeys}`);
  if (packed.scripts && Object.keys(packed.scripts).some((k) => /^(pre|post)?install$|^prepare$/.test(k))) throw new Error("packed manifest has install-time scripts");
  console.log(`Tarball OK: ${entries.length} files.`);

  // 3. Package linters on the tarball itself.
  run(bin("publint"), [tgz, "--strict"]);
  run(bin("attw"), [tgz, "--profile", "esm-only"]);

  // 4. Consumer projects.
  const consumer = (name, deps) => {
    const dir = join(work, name);
    const pkgDir = join(dir, "node_modules", manifest.name);
    mkdirSync(pkgDir, { recursive: true });
    run("tar", ["-xzf", tgz, "-C", pkgDir, "--strip-components=1"]);
    for (const dep of deps) {
      const target = join(dir, "node_modules", dep);
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(resolveDep(dep), target, "dir");
    }
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `consumer-${name}`, private: true, type: "module" }));
    return dir;
  };
  const tsconfig = (resolution) => ({
    compilerOptions: {
      target: "es2022", lib: ["es2023", "dom", "dom.iterable"], strict: true, noEmit: true,
      skipLibCheck: false, jsx: "react-jsx", types: [],
      ...(resolution === "nodenext" ? { module: "nodenext", moduleResolution: "nodenext" } : { module: "esnext", moduleResolution: "bundler" }),
    },
  });
  const typecheck = (dir, label) => {
    for (const resolution of ["nodenext", "bundler"]) {
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...tsconfig(resolution), include: ["*.ts", "*.tsx"] }));
      run(bin("tsc"), ["-p", join(dir, "tsconfig.json")]);
      console.log(`Typecheck OK: ${label} (${resolution}).`);
    }
  };

  // 4a. Core only: no react and no @types/react installed.
  const core = consumer("core", ["@standard-schema/spec", "zod"]);
  writeFileSync(join(core, "index.ts"), `
import { z } from "zod";
import { defineTool, implementTool, registerTool, isToolError, ToolError, type InferToolInput } from "${manifest.name}";
const addTodo = defineTool({ name: "add_todo", description: "Add a todo.", input: z.object({ text: z.string().min(1) }), output: z.object({ count: z.number() }) });
type Input = InferToolInput<typeof addTodo>;
const input: Input = { text: "x" };
const tool = implementTool(addTodo, ({ text }) => ({ count: text.length }));
const controller = new AbortController();
const result: Promise<"registered" | "unsupported"> = registerTool(tool, { signal: controller.signal });
void result; void input;
const ok: boolean = isToolError(new ToolError("nope"));
void ok;
export {};
`);
  typecheck(core, "core without React");
  writeFileSync(join(core, "runtime.mjs"), `
const m = await import("${manifest.name}");
for (const k of ["defineTool", "implementTool", "registerTool", "registerTools", "createToolCatalog", "ToolError", "isToolError"]) if (typeof m[k] !== "function") throw new Error("missing export " + k);
console.log("Runtime import OK: core (ESM).");
`);
  run("node", ["runtime.mjs"], { cwd: core });
  writeFileSync(join(core, "runtime.cjs"), `
const m = require("${manifest.name}");
if (typeof m.defineTool !== "function") throw new Error("require(esm) failed");
console.log("Runtime require OK: core (require(esm), Node " + process.versions.node + ").");
`);
  run("node", ["runtime.cjs"], { cwd: core });

  // 4b. React consumer.
  const react = consumer("react", ["@standard-schema/spec", "zod", "react", "@types/react"]);
  writeFileSync(join(react, "app.tsx"), `
import { z } from "zod";
import { defineTool, implementTool } from "${manifest.name}";
import { RegisterTools, useRegisterTools, useToolCatalog } from "${manifest.name}/react";
const ping = defineTool({ name: "ping", description: "Ping.", input: z.object({}), output: z.object({ ok: z.boolean() }) });
const pingTool = implementTool(ping, () => ({ ok: true }));
export function App() {
  const { supported } = useRegisterTools([pingTool]);
  const catalog = useToolCatalog();
  void catalog;
  return <>{supported && <RegisterTools tools={[pingTool]} />}</>;
}
`);
  const reactTs = (resolution) => ({ ...tsconfig(resolution), include: ["*.tsx"] });
  for (const resolution of ["nodenext", "bundler"]) {
    const cfg = reactTs(resolution);
    cfg.compilerOptions.types = ["react"];
    writeFileSync(join(react, "tsconfig.json"), JSON.stringify(cfg));
    run(bin("tsc"), ["-p", join(react, "tsconfig.json")]);
    console.log(`Typecheck OK: React consumer (${resolution}).`);
  }
  writeFileSync(join(react, "runtime.mjs"), `
const r = await import("${manifest.name}/react");
for (const k of ["useRegisterTools", "RegisterTools", "useToolCatalog"]) if (typeof r[k] !== "function") throw new Error("missing export " + k);
console.log("Runtime import OK: react subpath.");
`);
  run("node", ["runtime.mjs"], { cwd: react });

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    cpSync(tgz, join(outDir, "pkg.tgz"));
    console.log(`Kept tarball at ${join(outDir, "pkg.tgz")}.`);
  }
  console.log("Package tests passed.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
