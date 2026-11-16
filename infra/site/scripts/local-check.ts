// Credential-free end-to-end check: serve the artifact with `alchemy dev` (local workerd, the same
// asset router as Cloudflare, with this infra's _headers and 404 config), then run the deploy
// smoke test against it. Adapted from webmcp-sdk infra/docs/scripts/local-check.ts.
//   SITE_ARTIFACT_DIR=../../apps/site/out node scripts/local-check.ts
//   node scripts/local-check.ts --ssr-fixture   same assets + test/fixtures/ssr-server as server/
//                                               (site.server: true, bundle: false, /api/hello)
//   SITE_ARTIFACT_DIR=<dir> SERVER_ENTRY=server.js SMOKE_PATHS=/,/docs node scripts/local-check.ts --server
//                                               any prebuilt SSR artifact (e.g. a TanStack Start build)
// `alchemy dev` creates no cloud resource for this Worker; the credentials are placeholders.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let artifact = resolve(process.env.SITE_ARTIFACT_DIR ?? join(pkg, "../../apps/site/out"));
const scratch = mkdtempSync(join(tmpdir(), "local-check-"));
if (process.argv.includes("--server")) {
  const config = JSON.parse(readFileSync(join(pkg, "../../delivery.config.json"), "utf8"));
  config.site.server = true;
  config.site.serverEntry = process.env.SERVER_ENTRY || "index.js";
  if (process.env.SMOKE_PATHS) config.site.smokePaths = process.env.SMOKE_PATHS.split(",");
  process.env.DELIVERY_CONFIG = join(scratch, "delivery.config.json");
  writeFileSync(process.env.DELIVERY_CONFIG, JSON.stringify(config));
} else if (process.argv.includes("--ssr-fixture")) {
  const config = JSON.parse(readFileSync(join(pkg, "../../delivery.config.json"), "utf8"));
  config.site.server = true;
  config.site.smokePaths.push("/api/hello");
  process.env.DELIVERY_CONFIG = join(scratch, "delivery.config.json");
  writeFileSync(process.env.DELIVERY_CONFIG, JSON.stringify(config));
  cpSync(join(artifact, "assets"), join(scratch, "art", "assets"), { recursive: true });
  cpSync(join(pkg, "test/fixtures/ssr-server"), join(scratch, "art", "server"), { recursive: true });
  artifact = join(scratch, "art");
}
const stage = "ci_local_check";
const stack = `${(JSON.parse(readFileSync(process.env.DELIVERY_CONFIG ?? join(pkg, "../../delivery.config.json"), "utf8")) as { project: string }).project}-site`;
/** What `alchemy dev` writes for this stage (state + local runtime cache), nothing else. */
const ownStageDirs = () => [join(pkg, ".alchemy/state", stack, stage), join(pkg, ".alchemy/local/cache", `${stack}-${stage.replaceAll("_", "-")}`)];
const revision = `main@${"0".repeat(7)}`;
const home = mkdtempSync(join(tmpdir(), "alchemy-home-"));

const child = spawn(join(pkg, "node_modules/.bin/alchemy"), ["dev", "--stage", stage, "--no-input"], {
  cwd: pkg,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    PATH: process.env.PATH,
    HOME: home,
    ALCHEMY_HOME: join(home, ".alchemy"),
    ALCHEMY_PLAIN: "1",
    DO_NOT_TRACK: "1",
    ALCHEMY_TELEMETRY_DISABLED: "1",
    SITE_ARTIFACT_DIR: artifact,
    SITE_REVISION: revision,
    ...(process.env.DELIVERY_CONFIG ? { DELIVERY_CONFIG: process.env.DELIVERY_CONFIG } : {}),
    CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
    CLOUDFLARE_API_TOKEN: "local-check-placeholder-not-a-token",
  },
});

const stop = () => {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {}
  rmSync(home, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
  // Only this check's own stage: a developer's other local stages in .alchemy/ are left alone.
  for (const dir of ownStageDirs()) rmSync(dir, { recursive: true, force: true });
};

let log = "";
const ready = new Promise<string>((ok, ko) => {
  const timer = setTimeout(() => ko(new Error("alchemy dev not ready after 90s")), 90_000);
  const onData = (chunk: Buffer) => {
    log += chunk.toString();
    const m = /ready at (http:\/\/localhost:\d+)/.exec(log);
    if (m?.[1]) {
      clearTimeout(timer);
      ok(m[1]);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    clearTimeout(timer);
    ko(new Error(`alchemy dev exited (${code})`));
  });
});

try {
  const url = `${await ready}/`;
  console.log(`serving ${artifact} at ${url} (local workerd)`);
  const smoke = spawnSync(process.execPath, [join(pkg, "scripts/cli.ts"), "smoke"], { stdio: "inherit", env: { ...process.env, SMOKE_URL: url, REVISION: revision } });
  // A preview must not be indexable: the noindex header comes from the same _headers.
  const res = await fetch(url);
  await res.arrayBuffer();
  const noindex = res.headers.get("x-robots-tag")?.includes("noindex") ?? false;
  const missing = await fetch(new URL("/does-not-exist", url));
  await missing.arrayBuffer();
  console.log(`noindex on a non-production stage: ${noindex}; unknown path -> HTTP ${missing.status}`);
  process.exitCode = smoke.status === 0 && noindex && missing.status === 404 ? 0 : 1;
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  console.error(log);
  process.exitCode = 1;
} finally {
  stop();
}
