// The GitHub environments setup-github.mjs creates, as pure data: name, deployment branches, and
// the EXACT PUT body. Unit-tested (v0.3.4, first real --apply):
//   - production never gets a reviewer unless --production-reviewer (--preview-reviewer used to
//     add one to production too);
//   - v0.4.0 (D13, automatic previews): the preview environment NEVER gets a reviewer;
//     --preview-reviewer is refused (it made previews and cleanups wait for a human);
//   - "no reviewer" always sends `reviewers: []`: GitHub KEEPS existing reviewers when the key is
//     absent (verified live), so re-running without a flag must actively clear them.
export function environmentPlan({ site, defaultBranch, releaseBranches, releaseMode, reviewerId, flags }) {
  const body = (withReviewer) => ({
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    ...(withReviewer ? { reviewers: [{ type: "User", id: reviewerId }], prevent_self_review: false } : { reviewers: [] }),
  });
  const has = (f) => flags.includes(f);
  if (has("--preview-reviewer")) throw new Error("--preview-reviewer was removed in kit v0.4.0: previews are automatic (D13); the preview environment's barrier is its default-branch-only policy");
  return [
    { name: `${site}-preview`, branches: [defaultBranch], body: body(false) }, // D13: never a reviewer
    { name: `${site}-production`, branches: [defaultBranch], body: body(has("--production-reviewer")) },
    // D8: stage mode = npm 2FA approval is the gate (no reviewer); direct mode = reviewer required.
    { name: "npm-release", branches: releaseBranches, body: body(releaseMode === "direct" || has("--npm-release-reviewer")) },
    { name: "release-finalize", branches: releaseBranches, body: body(true) },
  ];
}
