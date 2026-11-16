// One-time, idempotent Cloudflare setup, run on a workstation (never in CI) with a TEMPORARY broad
// account token that the owner deletes afterwards. Adapted from webmcp-sdk
// infra/docs/scripts/bootstrap.ts. The token is read from a file, never printed or put in argv.
//
//   node infra/site/scripts/bootstrap.ts --account-id <32 hex> --token-file <path> --out-dir <private dir> [--subdomain <name>] [--check]
//
//   1. the account's workers.dev subdomain (read; created only if absent and --subdomain given)
//   2. the two Alchemy state stores (<worker>-state, <worker>-preview-state): `alchemy state
//      bootstrap` if absent, then their bearer tokens -> <out-dir>/<store>.token (0600)
//   3. the production Worker, created with a placeholder page ONLY if absent, so that the
//      production CI token can be scoped to that one Worker
//   4. prints the two CI tokens the owner creates, and the next command (tooling/setup-github.mjs)
// --check only reads.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT_ID, cfErrors, cloudflare, redact, type CloudflareClient } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { assertSubdomain, stateStores, stateStoreUrl, workerName } from "../src/stage.ts";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();
const base = config.site.worker;

function arg(argv: readonly string[], flag: string) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function workerAccess(cf: CloudflareClient, accountId: string, name: string) {
  const { status, body } = await cf.request("GET", `/accounts/${accountId}/workers/scripts/${name}/settings`);
  if (body?.success) return "present";
  if (status === 404 || /10007|not found/i.test(cfErrors(body))) return "absent";
  throw new Error(`cannot read Worker ${name}: HTTP ${status} ${cfErrors(body)} (the bootstrap token needs Workers Admin on all Workers)`);
}

async function subdomainOf(cf: CloudflareClient, accountId: string, wanted: string | undefined, check: boolean) {
  const { body } = await cf.request<{ subdomain?: string }>("GET", `/accounts/${accountId}/workers/subdomain`);
  const existing = body?.success ? body.result?.subdomain : undefined;
  if (existing) {
    if (wanted && wanted !== existing) throw new Error(`the account already uses workers.dev subdomain "${existing}"; never changed (it would break every URL)`);
    return existing;
  }
  if (!wanted) throw new Error("the account has no workers.dev subdomain: pass --subdomain <name>");
  if (check) return assertSubdomain(wanted);
  const res = await cf.request<{ subdomain: string }>("PUT", `/accounts/${accountId}/workers/subdomain`, { subdomain: assertSubdomain(wanted) });
  if (!res.body?.success) throw new Error(`cannot create the subdomain: ${cfErrors(res.body)}`);
  return res.body.result.subdomain;
}

/** Alchemy caches a store's bearer token under ALCHEMY_HOME when it logs in to the store. */
function findCachedStoreToken(home: string, store: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (name.endsWith(".json")) {
        try {
          const token = (JSON.parse(readFileSync(path, "utf8")) as { stores?: Record<string, { authToken?: string }> }).stores?.[store]?.authToken;
          if (token) return token;
        } catch {
          // not ours
        }
      }
    }
    return undefined;
  };
  return existsSync(home) ? walk(home) : undefined;
}

export async function main(argv: readonly string[]) {
  const accountId = arg(argv, "--account-id") ?? "";
  if (!ACCOUNT_ID.test(accountId)) throw new Error("--account-id must be the 32-hex Cloudflare account ID");
  const tokenFile = arg(argv, "--token-file") ?? "";
  const outDir = arg(argv, "--out-dir") ?? "";
  if (!tokenFile || !outDir) throw new Error("--token-file and --out-dir are required");
  const check = argv.includes("--check");
  if ((statSync(tokenFile).mode & 0o077) !== 0) console.log("warning: the token file is readable by other users; chmod 600 it");
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token || /\s/.test(token)) throw new Error("the token file must contain exactly one token");
  const cf = cloudflare(token);
  const home = mkdtempSync(join(tmpdir(), "site-bootstrap-home-"));
  const secrets = [token];
  try {
    const subdomain = await subdomainOf(cf, accountId, arg(argv, "--subdomain"), check);
    console.log(`workers.dev subdomain: ${subdomain}`);
    const alchemy = (args: string[], extra: Record<string, string>) => {
      const cwd = mkdtempSync(join(tmpdir(), "site-bootstrap-cwd-"));
      try {
        const res = spawnSync(join(pkg, "node_modules/.bin/alchemy"), [...args, "--config", join(pkg, "alchemy.run.ts")], {
          cwd,
          encoding: "utf8",
          env: { PATH: process.env.PATH, HOME: home, ALCHEMY_HOME: join(home, ".alchemy"), ALCHEMY_PLAIN: "1", DO_NOT_TRACK: "1", ALCHEMY_TELEMETRY_DISABLED: "1", SITE_ALLOW_LOCAL_REMOTE: "1", CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_WORKERS_SUBDOMAIN: subdomain, ...extra },
        });
        console.log(redact(`${res.stdout ?? ""}${res.stderr ?? ""}`, secrets).trim().split("\n").map((l) => `  | ${l}`).join("\n"));
        if (res.status !== 0) throw new Error(`alchemy ${args.join(" ")} failed (exit ${res.status})`);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    };

    if (!check) mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const bearers: Record<string, string> = {};
    for (const store of Object.values(stateStores(base))) {
      if ((await workerAccess(cf, accountId, store)) === "absent") {
        if (check) {
          console.log(`state store ${store}: absent`);
          continue;
        }
        console.log(`state store ${store}: absent, bootstrapping…`);
        alchemy(["state", "bootstrap"], { SITE_STATE: "cloudflare", SITE_STATE_STORE: store });
      }
      alchemy(["state", "list"], { SITE_STATE: "cloudflare", SITE_STATE_STORE: store });
      const bearer = findCachedStoreToken(home, store);
      if (!bearer) throw new Error(`could not read the bearer token of ${store}`);
      secrets.push(bearer);
      const probe = await fetch(`${stateStoreUrl(store, subdomain)}/state/stacks`, { headers: { authorization: `Bearer ${bearer}` } });
      await probe.arrayBuffer();
      if (probe.status !== 200) throw new Error(`${store} refuses its own bearer token (HTTP ${probe.status})`);
      console.log(`state store ${store}: present`);
      bearers[store] = bearer;
      if (!check) {
        const file = join(outDir, `${store}.token`);
        writeFileSync(file, bearer, { mode: 0o600 });
        chmodSync(file, 0o600);
      }
    }

    const prod = workerName(base, "production");
    if ((await workerAccess(cf, accountId, prod)) === "present") console.log(`Worker ${prod}: present (left as it is)`);
    else if (check) console.log(`Worker ${prod}: absent`);
    else {
      console.log(`Worker ${prod}: absent, creating it with a placeholder page…`);
      const dir = mkdtempSync(join(tmpdir(), "site-placeholder-"));
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets", "index.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${config.project}</title><p>First deploy pending.</p>\n`);
      if (config.site.server) {
        mkdirSync(join(dir, "server"));
        writeFileSync(join(dir, "server", "index.js"), "export default { fetch: (r, env) => env.ASSETS.fetch(r) };\n");
      }
      try {
        alchemy(["deploy", "--stage", "production", "--yes", "--no-input"], { SITE_STATE: "http", SITE_STATE_STORE: stateStores(base).production, SITE_STATE_TOKEN: bearers[stateStores(base).production] ?? "", SITE_ARTIFACT_DIR: dir });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    console.log(
      [
        "",
        "OWNER — create two ACCOUNT API tokens (Manage Account → API Tokens → Custom token), expiry ≤ 1 year:",
        `  ci-${base}-production   Workers · Specified Workers: ${prod} · Editor        (nothing else)`,
        `  ci-${base}-preview      Workers · Admin, account-wide (Editor cannot create)   (creates/deletes ${base}-pr-<n>)`,
        "  The preview token can also modify production (Cloudflare cannot scope by name prefix): docs/limits.md L1.",
        "  Then DELETE the temporary bootstrap token.",
        "",
        "AGENT — configure GitHub (reads token files, never echoes them):",
        `  node tooling/setup-github.mjs --repo <owner/name> --reviewer <login> --account-id ${accountId} --subdomain ${subdomain} \\`,
        `    --prod-token-file <file> --preview-token-file <file> --state-dir ${outDir} --apply`,
        "Then delete every token file.",
      ].join("\n"),
    );
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), secrets));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
