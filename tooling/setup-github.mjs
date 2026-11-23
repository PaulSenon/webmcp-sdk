// One-time GitHub configuration for the kit, through the owner's authenticated `gh` CLI.
// DRY RUN by default: prints every call (never a secret value). --apply executes them.
// Idempotent (PUT environments, policies created if missing, secrets/variables overwritten).
//
//   node tooling/setup-github.mjs --repo owner/name --reviewer <github login> \
//     [--account-id <32 hex> --subdomain <workers.dev> --prod-token-file F --preview-token-file F --state-dir D] [--preview-mode M] [--production-reviewer] [--npm-release-reviewer] [--no-ruleset] [--apply]
//
// Creates (<site> = delivery.config.json site.name, <SITE> uppercased):
//   environments <site>-preview + <site>-production (default branch only; NEVER a reviewer on
//   preview — automatic previews, D13; production only with --production-reviewer; `reviewers: []` is
//   always sent otherwise, so re-running without the flag removes a reviewer); npm-release (release branches; reviewer REQUIRED in
//   direct mode, none in stage mode where npm 2FA approval is the gate); release-finalize
//   (release branches + required reviewer); env secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//   <SITE>_STATE_TOKEN; variables <SITE>_WORKERS_SUBDOMAIN (+ <SITE>_PREVIEW_MODE with --preview-mode);
//   ruleset "delivery-kit" requiring PRs + previews.requiredChecks + dependency-review (--no-ruleset to skip);
//   Dependency graph (vulnerability alerts + automated security fixes) enabled if off: dependency-review needs it.
// Does NOT set <SITE>_DEPLOY_ENABLED: turning deploys on is the owner's explicit decision.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { environmentPlan } from "./github-environments.mjs";
import { gateChecksError, missingChecks, missingChecksError, requiredChecks, workflowChecks } from "./required-checks.mjs";

const argv = process.argv.slice(2);
const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const apply = argv.includes("--apply");
const repo = opt("--repo") ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("--repo owner/name is required");
const reviewer = opt("--reviewer");
if (!reviewer || !/^[\w-]+$/.test(reviewer)) throw new Error("--reviewer <github login> is required (npm-release approvals)");
const config = JSON.parse(readFileSync("delivery.config.json", "utf8"));
const worker = config.site.worker;
const site = config.site.name;
const SITE = site.toUpperCase();
const releaseBranches = Object.keys(config.release.branches);
// previews.requiredChecks + previews.prOnlyChecks (default ["dependency-review"]); each must be a job
// of .github/workflows, else the ruleset would block every PR on a check that never reports.
export const REQUIRED_CHECKS = requiredChecks(config);
const produced = workflowChecks(".github/workflows");
const checksError = missingChecksError(missingChecks(REQUIRED_CHECKS, produced.names), produced.unverifiable);
if (checksError) throw new Error(checksError);
const gateError = gateChecksError(config, ".github/workflows"); // preview gate (D13)
if (gateError) throw new Error(gateError);

const gh = (args, input, shownInput = "(secret, from stdin)") => {
  const shown = `gh ${args.join(" ")}${input === undefined ? "" : ` <<< ${shownInput}`}`;
  if (!apply) return console.log(`[dry-run] ${shown}`), "";
  console.log(shown);
  return execFileSync("gh", args, { input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"] });
};
const api = (method, path, body) => gh(["api", "-X", method, path, ...(body ? ["--input", "-"] : [])], body ? JSON.stringify(body) : undefined, body ? JSON.stringify(body) : "");

const defaultBranch = apply ? gh(["api", `repos/${repo}`, "--jq", ".default_branch"]).trim() : "main";
const reviewerId = apply ? Number(gh(["api", `users/${reviewer}`, "--jq", ".id"]).trim()) : 0;

function environment({ name, branches, body }) {
  api("PUT", `repos/${repo}/environments/${name}`, body);
  const existing = apply ? JSON.parse(gh(["api", `repos/${repo}/environments/${name}/deployment-branch-policies`]) || "{}").branch_policies ?? [] : [];
  for (const b of branches) if (!existing.some((p) => p.name === b)) api("POST", `repos/${repo}/environments/${name}/deployment-branch-policies`, { name: b, type: "branch" });
  for (const p of existing) if (!branches.includes(p.name)) api("DELETE", `repos/${repo}/environments/${name}/deployment-branch-policies/${p.id}`);
}

if (config.release.mode === "direct" && !reviewerId && apply) throw new Error("direct mode requires a reviewer on npm-release");
// Exact bodies in github-environments.mjs (tested). npm-release reviewer by mode (D8).
for (const env of environmentPlan({ site, defaultBranch, releaseBranches, releaseMode: config.release.mode, reviewerId, flags: argv })) environment(env);

const secret = (name, env, file) => {
  if (!file) return console.log(`skip ${name} (${env}): no file given`);
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  gh(["secret", "set", name, "--repo", repo, "--env", env], readFileSync(file, "utf8").trim());
};
const accountId = opt("--account-id");
if (accountId) {
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error("--account-id must be 32 hex");
  for (const env of [`${site}-preview`, `${site}-production`]) gh(["secret", "set", "CLOUDFLARE_ACCOUNT_ID", "--repo", repo, "--env", env], accountId);
}
secret("CLOUDFLARE_API_TOKEN", `${site}-production`, opt("--prod-token-file"));
secret("CLOUDFLARE_API_TOKEN", `${site}-preview`, opt("--preview-token-file"));
const stateDir = opt("--state-dir");
if (stateDir) {
  secret(`${SITE}_STATE_TOKEN`, `${site}-production`, join(stateDir, `${worker}-state.token`));
  secret(`${SITE}_STATE_TOKEN`, `${site}-preview`, join(stateDir, `${worker}-preview-state.token`));
}
const subdomain = opt("--subdomain");
if (subdomain) gh(["variable", "set", `${SITE}_WORKERS_SUBDOMAIN`, "--repo", repo, "--body", subdomain]);
const mode = opt("--preview-mode");
if (mode) {
  if (mode !== "dynamic" && mode !== "staging") throw new Error("--preview-mode dynamic|staging");
  gh(["variable", "set", `${SITE}_PREVIEW_MODE`, "--repo", repo, "--body", mode]);
}

// Dependency graph: `dependency-review` (a required check) fails with "not supported on this
// repository" without it, blocking every PR (found by Better Upload). Enabling vulnerability alerts
// turns it on; automated security fixes are enabled alongside. Checked even in dry run.
const alertsOn = (() => {
  if (!apply) return undefined;
  try {
    execFileSync("gh", ["api", `repos/${repo}/vulnerability-alerts`], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" }); // 204 = on
    return true;
  } catch (error) {
    // 404 = off. Any other error (auth, network) is NOT "off": stop instead of guessing.
    if (/HTTP 404/.test(String(error.stderr ?? ""))) return false;
    throw new Error(`cannot read vulnerability-alerts of ${repo}: ${String(error.stderr ?? error.message).trim()}`);
  }
})();
if (alertsOn === true) console.log("dependency graph / vulnerability alerts: already enabled");
else {
  api("PUT", `repos/${repo}/vulnerability-alerts`);
  api("PUT", `repos/${repo}/automated-security-fixes`);
}

// Ruleset: PRs required on the default branch, CI checks required, no force-push/deletion.
// --no-ruleset: the repository already has its own rulesets (add the kit's checks there instead).
if (argv.includes("--no-ruleset")) {
  console.log(`ruleset skipped: make sure ${REQUIRED_CHECKS.join(", ")} are required on the default branch`);
  console.log(apply ? `\nDone. Deploys stay off until: gh variable set ${SITE}_DEPLOY_ENABLED --body true` : "\nDry run only. Re-run with --apply.");
  process.exit(0);
}
const rulesets = apply ? JSON.parse(gh(["api", `repos/${repo}/rulesets`]) || "[]") : [];
const ruleset = {
  name: "delivery-kit",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: REQUIRED_CHECKS.map((context) => ({ context, integration_id: 15368 })) } }, // 15368 = GitHub Actions
  ],
};
const found = rulesets.find((r) => r.name === "delivery-kit");
api(found ? "PUT" : "POST", `repos/${repo}/rulesets${found ? `/${found.id}` : ""}`, ruleset);

console.log(apply ? `\nDone. Deploys stay off until: gh variable set ${SITE}_DEPLOY_ENABLED --body true` : "\nDry run only. Re-run with --apply.");
