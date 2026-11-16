// One-time GitHub configuration for the kit, through the owner's authenticated `gh` CLI.
// DRY RUN by default: prints every call (never a secret value). --apply executes them.
// Idempotent (PUT environments, policies created if missing, secrets/variables overwritten).
//
//   node tooling/setup-github.mjs --repo owner/name --reviewer <github login> \
//     [--account-id <32 hex> --subdomain <workers.dev> --prod-token-file F --preview-token-file F --state-dir D] [--preview-mode M] [--preview-reviewer] [--npm-release-reviewer] [--no-ruleset] [--apply]
//
// Creates (<site> = delivery.config.json site.name, <SITE> uppercased):
//   environments <site>-preview + <site>-production (default branch only, no reviewer: optional,
//   owner's choice via --preview-reviewer); npm-release (release branches; reviewer REQUIRED in
//   direct mode, none in stage mode where npm 2FA approval is the gate); release-finalize
//   (release branches + required reviewer); env secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//   <SITE>_STATE_TOKEN; variables <SITE>_WORKERS_SUBDOMAIN (+ <SITE>_PREVIEW_MODE with --preview-mode);
//   ruleset "delivery-kit" requiring PRs + previews.requiredChecks + dependency-review (--no-ruleset to skip).
// Does NOT set <SITE>_DEPLOY_ENABLED: turning deploys on is the owner's explicit decision.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
export const REQUIRED_CHECKS = [...new Set([...config.previews.requiredChecks, "dependency-review"])];

const gh = (args, input, shownInput = "(secret, from stdin)") => {
  const shown = `gh ${args.join(" ")}${input === undefined ? "" : ` <<< ${shownInput}`}`;
  if (!apply) return console.log(`[dry-run] ${shown}`), "";
  console.log(shown);
  return execFileSync("gh", args, { input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"] });
};
const api = (method, path, body) => gh(["api", "-X", method, path, ...(body ? ["--input", "-"] : [])], body ? JSON.stringify(body) : undefined, body ? JSON.stringify(body) : "");

const defaultBranch = apply ? gh(["api", `repos/${repo}`, "--jq", ".default_branch"]).trim() : "main";
const reviewerId = apply ? Number(gh(["api", `users/${reviewer}`, "--jq", ".id"]).trim()) : 0;

function environment(name, branches, withReviewer) {
  api("PUT", `repos/${repo}/environments/${name}`, {
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    ...(withReviewer ? { reviewers: [{ type: "User", id: reviewerId }], prevent_self_review: false } : {}),
  });
  const existing = apply ? JSON.parse(gh(["api", `repos/${repo}/environments/${name}/deployment-branch-policies`]) || "{}").branch_policies ?? [] : [];
  for (const b of branches) if (!existing.some((p) => p.name === b)) api("POST", `repos/${repo}/environments/${name}/deployment-branch-policies`, { name: b, type: "branch" });
  for (const p of existing) if (!branches.includes(p.name)) api("DELETE", `repos/${repo}/environments/${name}/deployment-branch-policies/${p.id}`);
}

environment(`${site}-preview`, [defaultBranch], argv.includes("--preview-reviewer"));
environment(`${site}-production`, [defaultBranch], argv.includes("--preview-reviewer"));
// npm-release reviewer by mode (kit decision D8): stage mode = none (the owner's npm 2FA approval
// of the stage, then the release-finalize reviewer, are the human gates); direct mode = REQUIRED.
const npmReviewer = config.release.mode === "direct" || argv.includes("--npm-release-reviewer");
if (config.release.mode === "direct" && !reviewerId && apply) throw new Error("direct mode requires a reviewer on npm-release");
environment("npm-release", releaseBranches, npmReviewer);
environment("release-finalize", releaseBranches, true);

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
