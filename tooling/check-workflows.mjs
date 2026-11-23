// Kit invariants for .github/workflows, complementary to actionlint/zizmor (which check syntax and
// generic hazards). These encode THIS kit's trust model (docs/decisions.md of the kit):
//   W1 top-level `permissions: {}` (every job declares its own)
//   W2 every remote action pinned to a full commit SHA
//   W3 every checkout has persist-credentials: false
//   W4 in a workflow a pull_request can run, a job holds secrets only through an environment whose
//      branch policy is the default branch only — THE barrier (a PR-run job is refused by it, even
//      if the PR edits the workflow). The required `if` excluding PR events is NOT a barrier (a PR
//      can delete it); it only avoids refused PR runs. No repository secrets there; no id-token.
//   W5 privileged triggers (workflow_run, pull_request_target) only check out the default branch
//   W6 id-token: write only in a job without checkout and without install/run of repository code
//   W7 no Actions cache in jobs that hold an environment
//   W8 no ${{ github.event.* }} / inputs.* expression inside `run:` (pass via env)
//   W9 no pull_request_target at all (teardown goes through workflow_run too)
//   W10 every job with an environment or id-token: write declares `cache-mode: none`
//   W11 automatic-preview policy (D13): the deploy workflow (workflow_run + job `sweep`) listens to
//       `requested` and `completed`, has an AT LEAST HOURLY schedule (a slower cadence only with a
//       `# local: sweep-cadence <why>` comment on the cron line); the site build workflow (job
//       `lifecycle`) runs on `closed`
//       and not on converted_to_draft / ready_for_review (drafts are previewed, not torn down)
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

  const jobs = wf.jobs ?? {};
  if (triggers.includes("workflow_run") && jobs.sweep) {
    const types = on.workflow_run?.types ?? [];
    for (const t of ["requested", "completed"]) if (!types.includes(t)) err("W11", `workflow_run.types must include ${t} (comment on build start; deploy/teardown on completion)`);
    const crons = (on.schedule ?? []).map((x) => String(x.cron ?? ""));
    const hourly = (c) => /^([0-5]?\d)\s+(\*|\*\/1)\s+\*\s+\*\s+\*$/.test(c.trim());
    const excepted = crons.some((c) => text.split("\n").some((l) => l.includes(c) && /#\s*local:\s*sweep-cadence\s+\S/.test(l)));
    if (!crons.some(hourly) && !excepted) err("W11", `the reconciliation sweep must run at least hourly (cron "M * * * *"), found [${crons.join(", ")}]; a slower cadence needs a "# local: sweep-cadence <why>" comment`);
  }
  if (triggers.includes("pull_request") && jobs.lifecycle) {
    const types = on.pull_request?.types ?? [];
    if (!types.includes("closed")) err("W11", "the site build workflow must run on pull_request closed (teardown fast path)");
    for (const t of ["converted_to_draft", "ready_for_review"]) if (types.includes(t)) err("W11", `pull_request ${t}: drafts are previewed like any open PR (D13), drop it`);
  }

  for (const [id, job] of Object.entries(jobs)) {
    const steps = job.steps ?? [];
    const jobText = JSON.stringify(job);
    const perms = job.permissions ?? {};
    if (unprivileged) {
      // A main-only environment job gated to non-PR events is safe on push (the workflow is the
      // default branch's) — e.g. Better Upload's cloud-tests. Repository secrets outside an
      // environment never are: a same-repo PR can edit the workflow and read them.
      const prRuns = triggers.includes("pull_request");
      const gatedOffPr = typeof job.if === "string" && (/github\.event_name\s*==\s*'(push|schedule|workflow_dispatch)'/.test(job.if) || /github\.event_name\s*!=\s*'pull_request'/.test(job.if));
      const allowed = !prRuns || (gatedOffPr && Boolean(job.environment));
      if (/secrets\.(?!GITHUB_TOKEN)/.test(jobText) && !allowed) err("W4", `job ${id} reads a secret in a workflow a pull_request can run: secrets only through an environment restricted to the default branch (that policy is the barrier; the if excluding PR events is not one, a PR can delete it)`);
      if (job.environment && !allowed) err("W4", `job ${id} uses an environment in a workflow a pull_request can run without an if excluding PR events (add it to avoid refused PR runs; the barrier is the environment's default-branch-only policy, verify it)`);
      if (perms["id-token"] === "write") err("W4", `job ${id} requests id-token in a PR-triggered workflow`);
    }
    if (perms["id-token"] === "write") {
      const forbidden = steps.filter((s) => (s.uses ?? "").startsWith("actions/checkout") || /\b(pnpm|npm|yarn) (install|ci|i)\b|pnpm run|node tooling|node infra/.test(s.run ?? ""));
      if (forbidden.length) err("W6", `job ${id} has id-token: write and checks out or runs repository code`);
    }
    if (job.environment && steps.some((s) => s.with && (s.with.cache || s.with["package-manager-cache"] === true))) err("W7", `job ${id} uses the Actions cache`);
    if ((job.environment || perms["id-token"] === "write") && job["cache-mode"] !== "none") err("W10", `job ${id} holds an environment or id-token but does not set cache-mode: none`);
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
