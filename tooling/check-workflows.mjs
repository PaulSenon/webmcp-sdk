// Kit invariants for .github/workflows, complementary to actionlint/zizmor (which check syntax and
// generic hazards). These encode THIS kit's trust model (docs/decisions.md of the kit):
//   W1 top-level `permissions: {}` (every job declares its own)
//   W2 every remote action pinned to a full commit SHA
//   W3 every checkout has persist-credentials: false
//   W4 workflows triggered by pull_request/push hold no secret, no environment, no id-token
//   W5 privileged triggers (workflow_run, pull_request_target) only check out the default branch
//   W6 id-token: write only in a job without checkout and without install/run of repository code
//   W7 no Actions cache in jobs that hold an environment
//   W8 no ${{ github.event.* }} / inputs.* expression inside `run:` (pass via env)
//   W9 no pull_request_target at all (teardown goes through workflow_run too)
//   node tooling/check-workflows.mjs <dir>   -> exit 1 with the list of violations
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export function checkWorkflow(file, text) {
  const errors = [];
  const err = (rule, msg) => errors.push(`${file}: ${rule} ${msg}`);
  const wf = parse(text);
  const on = typeof wf.on === "string" ? { [wf.on]: {} } : Array.isArray(wf.on) ? Object.fromEntries(wf.on.map((k) => [k, {}])) : wf.on ?? {};
  const triggers = Object.keys(on);
  const unprivileged = triggers.some((t) => t === "pull_request" || t === "push");
  const privileged = triggers.some((t) => t === "workflow_run" || t === "pull_request_target");
  if (unprivileged && privileged) err("W4", "mixes PR-defined triggers with privileged ones");
  if (!wf.permissions || Object.keys(wf.permissions).length) err("W1", "top-level permissions must be {}");
  if (triggers.includes("pull_request_target")) err("W9", "pull_request_target is not used by this kit");

  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const jobText = JSON.stringify(job);
    const perms = job.permissions ?? {};
    if (unprivileged) {
      if (/secrets\.(?!GITHUB_TOKEN)/.test(jobText)) err("W4", `job ${id} reads a secret in a PR-triggered workflow`);
      if (job.environment) err("W4", `job ${id} uses an environment in a PR-triggered workflow`);
      if (perms["id-token"] === "write") err("W4", `job ${id} requests id-token in a PR-triggered workflow`);
    }
    if (perms["id-token"] === "write") {
      const forbidden = steps.filter((s) => (s.uses ?? "").startsWith("actions/checkout") || /\b(pnpm|npm|yarn) (install|ci|i)\b|pnpm run|node tooling|node infra/.test(s.run ?? ""));
      if (forbidden.length) err("W6", `job ${id} has id-token: write and checks out or runs repository code`);
    }
    if (job.environment && steps.some((s) => s.with && (s.with.cache || s.with["package-manager-cache"] === true))) err("W7", `job ${id} uses the Actions cache`);
    for (const s of steps) {
      const uses = s.uses ?? "";
      if (uses && !uses.startsWith("./") && !/@[0-9a-f]{40}$/.test(uses)) err("W2", `job ${id}: ${uses} is not pinned to a commit SHA`);
      if (uses.startsWith("actions/checkout@")) {
        if (s.with?.["persist-credentials"] !== false) err("W3", `job ${id}: checkout without persist-credentials: false`);
        if (privileged && s.with?.ref !== "${{ github.event.repository.default_branch }}") err("W5", `job ${id}: privileged checkout must use ref: \${{ github.event.repository.default_branch }}`);
      }
      if (typeof s.run === "string" && /\$\{\{\s*(github\.event\.|inputs\.|github\.head_ref)/.test(s.run)) err("W8", `job ${id}: event/input expression inside run (use env)`);
    }
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? ".github/workflows";
  const errors = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => checkWorkflow(f, readFileSync(join(dir, f), "utf8")));
  for (const e of errors) console.error(`::error::${e}`);
  console.log(errors.length ? `${errors.length} violation(s)` : "workflow invariants ok");
  process.exit(errors.length ? 1 : 0);
}
