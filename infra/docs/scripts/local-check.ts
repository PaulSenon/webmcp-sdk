// Credential-free end-to-end check of the infra config: serve the static site with `alchemy dev`
// (local workerd, the same asset router Cloudflare runs, with this package's _headers and 404
// config), then run the smoke test against it. Used by PR checks, where no Cloudflare credentials
// exist, and locally:  DOCS_SITE_DIR=../../apps/docs/out node scripts/local-check.ts
//
// `alchemy dev` creates no cloud resource for an assets-only Worker and never calls the
// Cloudflare API here; the credential variables below are syntactic placeholders it requires.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSmoke } from "../src/smoke.ts";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = resolve(process.env.DOCS_SITE_DIR ?? join(pkg, "../../apps/docs/out"));
const stage = "ci_local_check";
const home = mkdtempSync(join(tmpdir(), "alchemy-home-"));

const child = spawn(join(pkg, "node_modules/.bin/alchemy"), ["dev", "--stage", stage, "--no-input"], {
  cwd: pkg,
  detached: true, // own process group, so workerd is stopped with it
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    HOME: home,
    ALCHEMY_HOME: join(home, ".alchemy"),
    ALCHEMY_PLAIN: "1",
    DO_NOT_TRACK: "1",
    ALCHEMY_TELEMETRY_DISABLED: "1",
    DOCS_SITE_DIR: siteDir,
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    CLOUDFLARE_API_TOKEN: "local-check-placeholder-not-a-token",
  },
});

const stop = () => {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {}
  rmSync(home, { recursive: true, force: true });
  // Only this check's own stage; other local stages in .alchemy/ are left alone.
  rmSync(join(pkg, ".alchemy/state/webmcp-sdk-docs", stage), { recursive: true, force: true });
  rmSync(join(pkg, ".alchemy/local/cache/webmcp-sdk-docs-ci-local-check"), { recursive: true, force: true });
};

let log = "";
const ready = new Promise<string>((resolveUrl, reject) => {
  const timer = setTimeout(() => reject(new Error(`alchemy dev not ready after 90s:\n${log}`)), 90_000);
  const onData = (chunk: Buffer) => {
    log += chunk.toString();
    const match = /ready at (http:\/\/localhost:\d+)/.exec(log);
    if (match?.[1]) {
      clearTimeout(timer);
      resolveUrl(match[1]);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`alchemy dev exited (${code}):\n${log}`));
  });
});

try {
  const url = await ready;
  console.log(`serving ${siteDir} at ${url} (local workerd)`);
  const result = await runSmoke({ url, siteDir, indexable: false, timeoutMs: 15_000, intervalMs: 500 });
  for (const check of result.checks) console.log(`ok  ${check}`);
  for (const warning of result.warnings) console.log(`::warning::${warning}`);
  for (const failure of result.failures) console.log(`::error::${failure}`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  console.error(log);
  process.exitCode = 1;
} finally {
  stop();
}
