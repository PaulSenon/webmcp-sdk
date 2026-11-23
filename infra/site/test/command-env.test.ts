// The per-command env table (scripts/command-env.json, v0.4.1) matches what cli.ts reads.
// Static: every env("X") / env("X", false) inside a command — directly or through a top-level
// helper (repo(), policy(), getPr(), targetOutputs()…, transitively) — is declared for it, and every
// declared name is really read (no stale entry). cli.ts also refuses undeclared reads at run time.
// The workflow side (every step maps the required names) is check-workflows W12; the real run of
// after-deploy / pr-check / orphan-check with the workflow's env is test/workflow-env.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../scripts/cli.ts", import.meta.url), "utf8");
const table = JSON.parse(readFileSync(new URL("../scripts/command-env.json", import.meta.url), "utf8")) as Record<string, { required: string[]; optional?: string[] }>;
delete (table as Record<string, unknown>)["//"];

/** Top-level helpers (`const x = (…) =>` / `function x(` / `async function x(`) and command bodies. */
function chunks() {
  const lines = source.split("\n");
  const helpers = new Map<string, string>();
  const commands = new Map<string, string>();
  let current: { kind: "helper" | "command"; name: string; body: string[] } | undefined;
  const flush = () => current && (current.kind === "helper" ? helpers : commands).set(current.name, current.body.join("\n"));
  for (const line of lines) {
    const h = /^(?:export )?(?:async )?(?:function (\w+)\(|const (\w+) = )/.exec(line);
    const c = /^  async (?:"([a-z-]+)"|([a-z]+))\(\) \{/.exec(line);
    if (h || c || /^const commands/.test(line)) {
      flush();
      current = h && !/^const commands/.test(line) ? { kind: "helper", name: (h[1] ?? h[2])!, body: [line] } : c ? { kind: "command", name: (c[1] ?? c[2])!, body: [line] } : undefined;
      continue;
    }
    current?.body.push(line);
  }
  flush();
  return { helpers, commands };
}

const READ = /\benv\("([A-Z0-9_]+)"(, false)?\)/g;
function reads(body: string, helpers: Map<string, string>, seen = new Set<string>()): { required: Set<string>; optional: Set<string> } {
  const out = { required: new Set<string>(), optional: new Set<string>() };
  for (const m of body.matchAll(READ)) (m[2] ? out.optional : out.required).add(m[1]!);
  for (const [name, hbody] of helpers) {
    if (name === "env" || seen.has(name) || !new RegExp(`\\b${name}\\(`).test(body)) continue;
    seen.add(name);
    const r = reads(hbody, helpers, seen);
    r.required.forEach((x) => out.required.add(x));
    r.optional.forEach((x) => out.optional.add(x));
  }
  return out;
}

test("command-env.json declares exactly what each cli.ts command reads", () => {
  const { helpers, commands } = chunks();
  assert.deepEqual([...commands.keys()].sort(), Object.keys(table).sort(), "one table entry per command");
  for (const [name, body] of commands) {
    const r = reads(body, helpers);
    const spec = table[name]!;
    const declared = new Set([...spec.required, ...(spec.optional ?? [])]);
    for (const x of r.required) assert.ok(spec.required.includes(x), `${name}: env("${x}") is read as required but not declared required`);
    for (const x of r.optional) assert.ok(declared.has(x), `${name}: env("${x}", false) is read but not declared`);
    for (const x of declared) assert.ok(r.required.has(x) || r.optional.has(x), `${name}: ${x} is declared but never read (stale entry)`);
  }
});

test("helpers that decide policy read their inputs through env() (BOT_PREVIEWS, PREVIEW_MODE are declared, never silently defaulted)", () => {
  assert.doesNotMatch(source, /process\.env\.(BOT_PREVIEWS|PREVIEW_MODE|ACTION|SMOKE_SOFT)\b/);
  assert.doesNotMatch(source, /previewMode\(config\)/);
});
