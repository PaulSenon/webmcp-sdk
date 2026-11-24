// The invariant checker passes on the kit's workflows and catches each regression it exists for.
// Portable (kit L9): runs unchanged in the template AND in any vendored copy — the site name comes
// from delivery.config.json, only kit-vendored workflows are asserted (a project's own ci.yml or a
// kept release.yml is the project's business), and a mutation whose anchor is absent is skipped.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkWorkflow, loadCommandEnv } from "./check-workflows.mjs";
import { renameSiteConfig, renameSiteText } from "./rename-site.mjs";

const dir = new URL("../.github/workflows/", import.meta.url).pathname;
const config = JSON.parse(readFileSync(new URL("../delivery.config.json", import.meta.url), "utf8"));
const n = config.site.name;
const SITE = `${n}.yml`;
const DEPLOY = `${n}-deploy.yml`;
const files = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const commandEnv = loadCommandEnv(dir);
const isKitFile = (f) => f === SITE || f === DEPLOY || (files[f] ?? "").includes("Monorepo Delivery Kit");

test("kit-vendored workflows satisfy every invariant", () => {
  assert.ok(files[SITE] && files[DEPLOY], `expected ${SITE} and ${DEPLOY} (site.name = ${n})`);
  for (const [f, text] of Object.entries(files)) if (isKitFile(f)) assert.deepEqual(checkWorkflow(f, text, { commandEnv }), [], f);
});

const mutations = [
  ["W2", SITE, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7"],
  ["W3", SITE, "persist-credentials: false", "persist-credentials: true"],
  ["W4", SITE, "      - run: pnpm install --frozen-lockfile\n", "      - env: { T: \"${{ secrets.CLOUDFLARE_API_TOKEN }}\" }\n        run: pnpm install --frozen-lockfile\n"],
  ["W5", DEPLOY, "ref: ${{ github.event.repository.default_branch }}", "ref: ${{ github.event.workflow_run.head_sha }}"],
  ["W6", "release.yml", "      # No checkout, no dependency install", "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with: { persist-credentials: false }\n      # No checkout, no dependency install"],
  ["W7", DEPLOY, "package-manager-cache: false # no cache restored into a privileged job", "cache: pnpm"],
  ["W8", DEPLOY, "run: node infra/site/scripts/cli.ts plan", "run: echo ${{ github.event.workflow_run.head_branch }}"],
  ["W9", DEPLOY, "  schedule:\n", "  pull_request_target:\n    types: [closed]\n  schedule:\n"],
  ["W1", DEPLOY, "\npermissions: {}\n", "\npermissions: write-all\n"],
  ["W10", DEPLOY, "    cache-mode: none # no Actions cache in this job (integrity > speed)\n", ""],
  ["W11", DEPLOY, '    - cron: "23 * * * *"', '    - cron: "23 4 * * 1"'],
  ["W11", DEPLOY, '    - cron: "23 * * * *"', '    - cron: "23 */6 * * *"'],
  ["W11", DEPLOY, "    types: [requested, completed]", "    types: [completed]"],
  ["W11", SITE, "    types: [opened, synchronize, reopened, closed]", "    types: [opened, synchronize, reopened]"],
  ["W12", DEPLOY, "          TRIGGER: ${{ github.event.action }}\n", ""],
  ["W13", DEPLOY, "\n          || (github.event_name == 'workflow_run' && github.event.action == 'completed'))", ")"],
  ["W13", DEPLOY, "  sweep:\n    name: deploy-sweep\n", "  sweep:\n    name: deploy-sweep\n    needs: plan\n"],
  ["W13", DEPLOY, "      group: site-preview-sweep\n      cancel-in-progress: false", "      group: site-preview-sweep\n      cancel-in-progress: true"],
  ["W13", DEPLOY, "  comment:\n    name: deploy-comment\n    needs: [plan, notify, preview, teardown]", "  comment:\n    name: deploy-comment\n    needs: [plan, notify, preview, teardown, sweep]"],
  ["W12", DEPLOY, "          BOT_PREVIEWS: ${{ vars.SITE_PREVIEW_DEPENDABOT }}\n          PR_NUMBER: ${{ needs.plan.outputs.pr }}\n        run: node infra/site/scripts/cli.ts after-deploy", "          PR_NUMBER: ${{ needs.plan.outputs.pr }}\n        run: node infra/site/scripts/cli.ts after-deploy"],
  ["W12", DEPLOY, "DEFAULT_BRANCH: ${{ github.event.repository.default_branch || github.ref_name }}", "DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}"],
  ["W12", SITE, "node infra/site/scripts/cli.ts write-manifest", "node infra/site/scripts/cli.ts write-manifst"],
  ["W11", SITE, "    types: [opened, synchronize, reopened, closed]", "    types: [opened, synchronize, reopened, ready_for_review, closed, converted_to_draft]"],
];

test("W11: a slower sweep is accepted only as an explicit local exception", { skip: (files[DEPLOY] ?? "").includes('    - cron: "23 * * * *"') ? false : "anchor absent" }, () => {
  const slower = files[DEPLOY].replace(/    - cron: "23 \* \* \* \*".*\n/, '    - cron: "23 */6 * * *" # local: sweep-cadence private repository, Actions minutes billed\n');
  assert.deepEqual(checkWorkflow(DEPLOY, slower, { commandEnv }).filter((e) => e.includes("W11")), []);
});

for (const [rule, file, from, to] of mutations) {
  const present = isKitFile(file) && (files[file] ?? "").includes(from);
  test(`${rule} is caught (${file})`, { skip: present ? false : `${file} is not the kit's or lacks the anchor` }, () => {
    const errors = checkWorkflow(file, files[file].replace(from, to), { commandEnv });
    assert.ok(errors.some((e) => e.includes(rule)), `${rule} not reported: ${errors.join("; ")}`);
  });
}

// Only in the kit's own template (site name "site"): the rendering for another name stays safe.
const inTemplate = n === "site" && existsSync(new URL("../packages/hello", import.meta.url));
test("rename-site: docs rendering keeps the invariants and leaves no template name behind", { skip: inTemplate ? false : "template only" }, () => {
  const site = renameSiteText(files[SITE], "docs");
  const deploy = renameSiteText(files[DEPLOY], "docs");
  assert.deepEqual(checkWorkflow("docs.yml", site, { commandEnv }), []);
  assert.deepEqual(checkWorkflow("docs-deploy.yml", deploy, { commandEnv }), []);
  for (const text of [site, deploy]) {
    assert.doesNotMatch(text, /vars\.SITE_|secrets\.SITE_|site-(build|deploy|preview|production|comment)\b|workflows: \[site\]/);
    // every concurrency group carries the site name (v0.4.0: site-comment-pr-* was left behind)
    for (const [, g] of text.matchAll(/^\s*group: (\S+)/gm)) assert.match(g, /^docs-/, `group ${g}`);
  }
  assert.match(site, /^name: docs$/m);
  assert.match(site, /name: docs-build/);
  assert.match(deploy, /workflows: \[docs\]/);
  assert.match(deploy, /name: docs-preview #/);
  assert.match(deploy, /vars\.DOCS_DEPLOY_ENABLED/);
  assert.match(deploy, /secrets\.DOCS_STATE_TOKEN/);
  assert.match(deploy, /SITE_STATE_TOKEN: \$\{\{ secrets\.DOCS_STATE_TOKEN \}\}/); // env read by the infra unchanged
  assert.ok(renameSiteConfig(config, "docs").previews.requiredChecks.includes("docs-build"));
});

test("workflow names match delivery.config.json", () => {
  assert.match(files[SITE], new RegExp(`^name: ${n}$`, "m"));
  assert.match(files[SITE], new RegExp(`name: ${n}-build`));
  assert.match(files[DEPLOY], new RegExp(`workflows: \\[${n}\\]`));
});

// W4 relaxation (Better Upload's cloud-tests): a push-only, environment-backed job in ci.yml is fine;
// the same job without the PR gate, or with repository secrets and no environment, is not.
test("W4 allows a main-only environment job gated off PR events, and only that", () => {
  const wf = (job) => `name: ci\non:\n  pull_request:\n  push:\n    branches: [main]\npermissions: {}\njobs:\n  cloud-tests:\n${job}    runs-on: ubuntu-24.04\n    cache-mode: none\n    permissions: {}\n    steps:\n      - env: { K: "\${{ secrets.R2_KEY }}" }\n        run: echo test\n`;
  const ok = "    if: github.event_name == 'push'\n    environment: cloud-tests\n";
  assert.deepEqual(checkWorkflow("ci.yml", wf(ok)), []);
  assert.ok(checkWorkflow("ci.yml", wf("    environment: cloud-tests\n")).some((e) => e.includes("W4")), "no PR gate");
  assert.ok(checkWorkflow("ci.yml", wf("    if: github.event_name == 'push'\n")).some((e) => e.includes("W4")), "repo secret, no environment");
  const pushOnly = wf("    environment: cloud-tests\n").replace("  pull_request:\n", "");
  assert.deepEqual(checkWorkflow("ci.yml", pushOnly), []);
});
