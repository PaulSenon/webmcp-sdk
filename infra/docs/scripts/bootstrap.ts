// One-time, idempotent setup of the docs deploy in ONE Cloudflare account. Run by an agent (or the
// maintainer) on a workstation, never in CI, with a TEMPORARY broad account token that Isaac
// deletes afterwards. The token is read from a file and is never printed, passed in argv, or
// written anywhere but child-process environments. State-store bearer tokens are written only to
// 0600 files in --out-dir, for `gh secret set … < file`.
//
//   node infra/docs/scripts/bootstrap.ts --account-id <32 hex> --token-file <path> \
//     --out-dir <private dir> [--subdomain <name>] [--check]
//
// Steps
//   1. verify the token: an active ACCOUNT-owned token of this account
//   2. the account's workers.dev subdomain (read; created only if the account has none)
//   3. the two Alchemy state stores, webmcp-sdk-docs-state (production) and
//      webmcp-sdk-docs-preview-state (staging/previews): `alchemy state bootstrap` if absent,
//      then their bearer tokens -> <out-dir>/<store>.token
//   4. the Workers webmcp-sdk-docs and webmcp-sdk-docs-staging, created with a placeholder page
//      ONLY if absent (an existing Worker is never overwritten), so per-Worker token scopes can
//      name them
//   5. print the permissions Isaac sets on the two CI tokens, and the gh commands
// `--check` only reads.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountName, ensureWorkersSubdomain, getWorkersSubdomain, verifyToken, workerAccess } from "../src/account.ts";
import { ACCOUNT_ID, cloudflare, redact, type CloudflareClient } from "../src/api.ts";
import { probeStateStore } from "../src/isolation.ts";
import { STATE_STORES, assertSubdomain, stateStoreUrl, workerName, type StateStoreName } from "../src/stage.ts";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface BootstrapArgs {
  accountId: string;
  tokenFile: string;
  outDir: string;
  subdomain?: string;
  check: boolean;
}

const FLAGS = ["--account-id", "--token-file", "--out-dir", "--subdomain", "--check"];

export function parseArgs(argv: readonly string[]): BootstrapArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  for (const arg of argv) {
    if (arg.startsWith("--") && !FLAGS.includes(arg)) {
      throw new Error(`unknown option ${arg} (the token is only accepted through --token-file)`);
    }
  }
  const accountId = get("--account-id") ?? "";
  if (!ACCOUNT_ID.test(accountId)) throw new Error("--account-id must be the 32-hex Cloudflare account ID");
  const tokenFile = get("--token-file");
  if (!tokenFile) throw new Error("--token-file <path> is required");
  const outDir = get("--out-dir");
  if (!outDir) throw new Error("--out-dir <private directory> is required (state-store tokens are written there)");
  const subdomain = get("--subdomain");
  if (subdomain !== undefined) assertSubdomain(subdomain);
  return { accountId, tokenFile, outDir, ...(subdomain ? { subdomain } : {}), check: argv.includes("--check") };
}

export function readToken(path: string): string {
  const st = statSync(path);
  if (!st.isFile()) throw new Error("--token-file is not a regular file");
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
    console.log("warning: the token file is readable by other users; chmod 600 it");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!token || /\s/.test(token) || token.length < 20) throw new Error("the token file must contain exactly one token");
  return token;
}

/** Find the bearer token Alchemy cached for a store under a throwaway ALCHEMY_HOME. */
export function findCachedStoreToken(home: string, store: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (name.endsWith(".json")) {
        try {
          const json = JSON.parse(readFileSync(path, "utf8")) as { stores?: Record<string, { authToken?: string }> };
          const token = json.stores?.[store]?.authToken;
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

interface Ctx {
  token: string;
  accountId: string;
  subdomain: string;
  home: string;
}

function alchemy(ctx: Ctx, args: string[], extra: Record<string, string>) {
  // cwd is throwaway so Alchemy's project logs (.alchemy/) never persist; ALCHEMY_HOME is the
  // throwaway home where it caches the state-store credentials we read back.
  const cwd = mkdtempSync(join(tmpdir(), "docs-bootstrap-cwd-"));
  try {
    const res = spawnSync(join(pkg, "node_modules/.bin/alchemy"), [...args, "--config", join(pkg, "alchemy.run.ts")], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: ctx.home,
        ALCHEMY_HOME: join(ctx.home, ".alchemy"),
        ALCHEMY_PLAIN: "1",
        DO_NOT_TRACK: "1",
        ALCHEMY_TELEMETRY_DISABLED: "1",
        DOCS_ALLOW_LOCAL_REMOTE: "1",
        CLOUDFLARE_API_TOKEN: ctx.token,
        CLOUDFLARE_ACCOUNT_ID: ctx.accountId,
        CLOUDFLARE_WORKERS_SUBDOMAIN: ctx.subdomain,
        ...extra,
      },
    });
    const secrets = [ctx.token, extra.DOCS_STATE_TOKEN];
    const out = redact(`${res.stdout ?? ""}${res.stderr ?? ""}`, secrets);
    console.log(out.trim().split("\n").map((l) => `  | ${l}`).join("\n"));
    if (res.status !== 0) throw new Error(`alchemy ${args.join(" ")} failed (exit ${res.status})`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function placeholderSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-placeholder-"));
  const page = (title: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head><body><p>${title}</p></body></html>\n`;
  writeFileSync(join(dir, "index.html"), page("webmcp-sdk documentation: first deploy pending"));
  writeFileSync(join(dir, "404.html"), page("Not found"));
  return dir;
}

async function ensureStore(cf: CloudflareClient, ctx: Ctx, store: StateStoreName, outDir: string, check: boolean) {
  let access = await workerAccess(cf, ctx.accountId, store);
  if (access === "forbidden") throw new Error(`the token cannot see ${store}: it needs Workers Admin (all Workers)`);
  if (access === "absent") {
    if (check) {
      console.log(`state store ${store}: absent`);
      return undefined;
    }
    console.log(`state store ${store}: absent, bootstrapping…`);
    alchemy(ctx, ["state", "bootstrap"], { DOCS_STATE: "cloudflare", DOCS_STATE_STORE: store });
    access = await workerAccess(cf, ctx.accountId, store);
    if (access !== "present") throw new Error(`state store ${store} still absent after bootstrap`);
  }
  // Read the store's bearer token back: Alchemy caches it outside CI under ALCHEMY_HOME when it
  // logs in to the store (through the account's Secrets Store, which this token may use).
  alchemy(ctx, ["state", "list"], { DOCS_STATE: "cloudflare", DOCS_STATE_STORE: store });
  const bearer = findCachedStoreToken(ctx.home, store);
  if (!bearer) throw new Error(`could not read the bearer token of ${store}`);
  const probe = await probeStateStore(stateStoreUrl(store, ctx.subdomain), bearer);
  if (!probe.authorized) throw new Error(`the bearer token read for ${store} is refused by the store`);
  console.log(`state store ${store}: present, state API v${probe.version}`);
  if (check) return undefined;
  const file = join(outDir, `${store}.token`);
  writeFileSync(file, bearer, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { store, file, bearer };
}

async function ensureWorker(cf: CloudflareClient, ctx: Ctx, stage: "production" | "staging", bearer: string | undefined, check: boolean) {
  const name = workerName(stage);
  const access = await workerAccess(cf, ctx.accountId, name);
  if (access === "present") {
    console.log(`Worker ${name}: present (left as it is)`);
    return;
  }
  if (access === "forbidden") throw new Error(`the token cannot see ${name}: it needs Workers Admin (all Workers)`);
  if (check || !bearer) {
    console.log(`Worker ${name}: absent`);
    return;
  }
  console.log(`Worker ${name}: absent, creating it with a placeholder page…`);
  const site = placeholderSite();
  try {
    alchemy(ctx, ["deploy", "--stage", stage, "--yes", "--no-input"], {
      DOCS_STATE: "http",
      DOCS_STATE_STORE: STATE_STORES[stage === "production" ? "production" : "preview"],
      DOCS_STATE_TOKEN: bearer,
      DOCS_SITE_DIR: site,
    });
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
  if ((await workerAccess(cf, ctx.accountId, name)) !== "present") throw new Error(`Worker ${name} still absent`);
}

export function permissionReport(subdomain: string): string {
  const prod = workerName("production");
  const staging = workerName("staging");
  return [
    "",
    "Isaac — create two ACCOUNT tokens (Manage Account → API Tokens → Create Token → Custom token):",
    "",
    `  github-docs-production   Workers · Specified Workers: ${prod} · Editor`,
    `  github-docs-staging      Workers · Specified Workers: ${staging} · Editor`,
    "",
    "  Nothing else: no Secrets Store, no zone, no account-wide Workers role, no access to the",
    `  state-store Workers (CI reaches state over HTTPS with the bearer tokens written to --out-dir).`,
    `  Expiration 1 year. Then delete the temporary bootstrap token.`,
    "",
    "Agent — GitHub (tokens through stdin only):",
    `  gh secret set CLOUDFLARE_API_TOKEN  --env docs-production < <github-docs-production token file>`,
    `  gh secret set DOCS_STATE_TOKEN      --env docs-production < <out-dir>/${STATE_STORES.production}.token`,
    `  gh secret set CLOUDFLARE_API_TOKEN  --env docs-preview    < <github-docs-staging token file>`,
    `  gh secret set DOCS_STATE_TOKEN      --env docs-preview    < <out-dir>/${STATE_STORES.preview}.token`,
    "  printf %s <account id> | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-production",
    "  printf %s <account id> | gh secret set CLOUDFLARE_ACCOUNT_ID --env docs-preview",
    `  gh variable set DOCS_WORKERS_SUBDOMAIN --body ${subdomain}`,
    "  gh variable set DOCS_PREVIEW_MODE --body staging",
    "Then delete every token file.",
  ].join("\n");
}

export async function main(argv: readonly string[]) {
  const args = parseArgs(argv);
  const token = readToken(args.tokenFile);
  const cf = cloudflare(token);
  const home = mkdtempSync(join(tmpdir(), "docs-bootstrap-home-"));
  try {
    const verified = await verifyToken(cf, args.accountId);
    if (verified.kind !== "account") throw new Error("use an account-owned token (Manage Account → API Tokens), not a user token");
    console.log(`token: account-owned, ${verified.status}${verified.expiresOn ? `, expires ${verified.expiresOn}` : ", no expiry"}`);
    console.log(`account: ${(await accountName(cf, args.accountId)) ?? "(name not readable with this token)"} (${args.accountId})`);

    let subdomain: string | undefined;
    try {
      subdomain = args.check ? await getWorkersSubdomain(cf, args.accountId) : (await ensureWorkersSubdomain(cf, args.accountId, args.subdomain)).subdomain;
    } catch (error) {
      // The account-level subdomain endpoint accepts the legacy "Workers Scripts" permissions only;
      // without them, trust --subdomain (from the dashboard) and let the store probe confirm it.
      if (!args.subdomain) throw error;
      console.log(`workers.dev subdomain not readable with this token; using --subdomain ${args.subdomain}`);
      subdomain = args.subdomain;
    }
    if (!subdomain) throw new Error("no workers.dev subdomain: pass --subdomain <name>");
    console.log(`workers.dev subdomain: ${subdomain}`);

    if (!args.check) {
      mkdirSync(args.outDir, { recursive: true, mode: 0o700 });
      chmodSync(args.outDir, 0o700);
    }
    const ctx: Ctx = { token, accountId: args.accountId, subdomain, home };
    const prodStore = await ensureStore(cf, ctx, STATE_STORES.production, args.outDir, args.check);
    const previewStore = await ensureStore(cf, ctx, STATE_STORES.preview, args.outDir, args.check);
    await ensureWorker(cf, ctx, "production", prodStore?.bearer, args.check);
    await ensureWorker(cf, ctx, "staging", previewStore?.bearer, args.check);
    console.log(permissionReport(subdomain));
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), [token]));
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
