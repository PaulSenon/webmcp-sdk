// One-time (idempotent) setup of one Cloudflare account for the docs deploy. Meant to be run by an
// agent or a maintainer on a workstation, never in CI. The token is read from a file and is never
// printed, passed in argv, or written anywhere but the child process environment.
//
//   node infra/docs/scripts/bootstrap.ts --role production|preview --account-id <32 hex> \
//     --token-file <path> [--subdomain <name>] [--check]
//
// Steps: verify the token (account token, else user token) → show the account → ensure the
// account's workers.dev subdomain (created only if missing and --subdomain is given) → bootstrap
// the Alchemy state store (`alchemy state bootstrap`, non-interactive) if absent → print what to
// set in GitHub. `--check` only reads: nothing is created.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accountName, ensureWorkersSubdomain, getWorkersSubdomain, stateStorePresent, verifyToken } from "../src/account.ts";
import { ACCOUNT_ID, cloudflare, redact } from "../src/api.ts";
import { STATE_STORE_WORKER } from "../src/stage.ts";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface BootstrapArgs {
  role: "production" | "preview";
  accountId: string;
  tokenFile: string;
  subdomain?: string;
  check: boolean;
}

export function parseArgs(argv: readonly string[]): BootstrapArgs {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  for (const arg of argv) {
    if (arg.startsWith("--") && !["--role", "--account-id", "--token-file", "--subdomain", "--check"].includes(arg)) {
      throw new Error(`unknown option ${arg} (the token is only accepted through --token-file)`);
    }
  }
  const role = get("--role");
  if (role !== "production" && role !== "preview") throw new Error("--role must be production or preview");
  const accountId = get("--account-id") ?? "";
  if (!ACCOUNT_ID.test(accountId)) throw new Error("--account-id must be the 32-hex Cloudflare account ID");
  const tokenFile = get("--token-file");
  if (!tokenFile) throw new Error("--token-file <path> is required");
  const subdomain = get("--subdomain");
  return { role, accountId, tokenFile, ...(subdomain ? { subdomain } : {}), check: argv.includes("--check") };
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

export function bootstrapStateStore(token: string, accountId: string) {
  // cwd is a throwaway directory so Alchemy's run logs (.alchemy/) and profile home never persist.
  const work = mkdtempSync(join(tmpdir(), "docs-bootstrap-"));
  try {
    const res = spawnSync(join(pkg, "node_modules/.bin/alchemy"), ["state", "bootstrap", "--config", join(pkg, "alchemy.run.ts")], {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: work,
        ALCHEMY_HOME: join(work, ".alchemy-home"),
        CI: "true", // credentials from the environment only, no profile, no prompt
        ALCHEMY_PLAIN: "1",
        DO_NOT_TRACK: "1",
        ALCHEMY_TELEMETRY_DISABLED: "1",
        DOCS_STATE: "cloudflare",
        DOCS_ALLOW_LOCAL_REMOTE: "1",
        CLOUDFLARE_API_TOKEN: token,
        CLOUDFLARE_ACCOUNT_ID: accountId,
      },
    });
    const out = redact(`${res.stdout ?? ""}${res.stderr ?? ""}`, [token]);
    console.log(out.trim().split("\n").map((l) => `  | ${l}`).join("\n"));
    if (res.status !== 0) throw new Error(`alchemy state bootstrap failed (exit ${res.status})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[]) {
  const args = parseArgs(argv);
  const token = readToken(args.tokenFile);
  const cf = cloudflare(token);
  try {
    const verified = await verifyToken(cf, args.accountId);
    console.log(`token: ${verified.kind}-owned, ${verified.status}${verified.expiresOn ? `, expires ${verified.expiresOn}` : ", no expiry"}`);
    const name = await accountName(cf, args.accountId);
    console.log(`account: ${name ?? "(name not readable with this token)"} (${args.accountId})`);

    const subdomain = args.check
      ? await getWorkersSubdomain(cf, args.accountId)
      : (await ensureWorkersSubdomain(cf, args.accountId, args.subdomain)).subdomain;
    console.log(`workers.dev subdomain: ${subdomain ?? "none yet (re-run without --check, with --subdomain <name>)"}`);

    let store = await stateStorePresent(cf, args.accountId);
    if (!store && !args.check) {
      console.log(`state store ${STATE_STORE_WORKER}: absent, bootstrapping…`);
      bootstrapStateStore(token, args.accountId);
      store = await stateStorePresent(cf, args.accountId);
      if (!store) throw new Error("state store still absent after bootstrap");
    }
    console.log(`state store ${STATE_STORE_WORKER}: ${store ? "present" : "absent"}`);

    const env = args.role === "production" ? "docs-production" : "docs-preview";
    const variable = args.role === "production" ? "DOCS_WORKERS_SUBDOMAIN" : "DOCS_PREVIEW_WORKERS_SUBDOMAIN";
    console.log(
      [
        "",
        "Next (from the repository root; the token goes through stdin, never argv):",
        `  gh secret set CLOUDFLARE_API_TOKEN --env ${env} < "$TOKEN_FILE"`,
        `  printf %s ${args.accountId} | gh secret set CLOUDFLARE_ACCOUNT_ID --env ${env}`,
        `  gh variable set ${variable} --body ${subdomain ?? "<subdomain>"}`,
        "Then delete the token file.",
      ].join("\n"),
    );
    if (args.check && (!store || !subdomain)) process.exitCode = 1;
  } catch (error) {
    throw new Error(redact(error instanceof Error ? error.message : String(error), [token]));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
