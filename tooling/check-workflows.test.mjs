// The invariant checker passes on the template's workflows and catches each regression it exists for.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkWorkflow } from "./check-workflows.mjs";

const dir = new URL("../.github/workflows/", import.meta.url).pathname;
const files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));

test("template workflows satisfy every invariant", () => {
  for (const [f, text] of Object.entries(files)) assert.deepEqual(checkWorkflow(f, text), [], f);
});

const mutations = [
  ["W2", "ci.yml", "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "actions/checkout@v7"],
  ["W3", "ci.yml", "persist-credentials: false", "persist-credentials: true"],
  ["W4", "ci.yml", "      - run: pnpm check #", "      - env: { T: \"${{ secrets.CLOUDFLARE_API_TOKEN }}\" }\n        run: pnpm check #"],
  ["W5", "site-deploy.yml", "ref: ${{ github.event.repository.default_branch }}", "ref: ${{ github.event.workflow_run.head_sha }}"],
  ["W6", "release.yml", "      # No checkout, no dependency install", "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with: { persist-credentials: false }\n      # No checkout, no dependency install"],
  ["W7", "site-deploy.yml", "package-manager-cache: false # no cache restored into a privileged job", "cache: pnpm"],
  ["W8", "site-deploy.yml", "run: node infra/site/scripts/cli.ts plan", "run: echo ${{ github.event.workflow_run.head_branch }}"],
  ["W9", "site-deploy.yml", "  schedule:\n", "  pull_request_target:\n    types: [closed]\n  schedule:\n"],
  ["W1", "site-deploy.yml", "\npermissions: {}\n", "\npermissions: write-all\n"],
];

for (const [rule, file, from, to] of mutations) {
  test(`${rule} is caught (${file})`, () => {
    assert.ok(files[file].includes(from), `mutation anchor missing in ${file}: ${from}`);
    const errors = checkWorkflow(file, files[file].replace(from, to));
    assert.ok(errors.some((e) => e.includes(rule)), `${rule} not reported: ${errors.join("; ")}`);
  });
}

// The template rendered for another site name (WebMCP: "docs") is still consistent and safe.
import { renameSiteConfig, renameSiteText } from "./rename-site.mjs";
test("rename-site: docs rendering keeps the invariants and leaves no template name behind", () => {
  const site = renameSiteText(files["site.yml"], "docs");
  const deploy = renameSiteText(files["site-deploy.yml"], "docs");
  assert.deepEqual(checkWorkflow("docs.yml", site), []);
  assert.deepEqual(checkWorkflow("docs-deploy.yml", deploy), []);
  for (const text of [site, deploy]) {
    assert.doesNotMatch(text, /vars\.SITE_|secrets\.SITE_|site-(build|deploy|preview|production)\b|workflows: \[site\]/);
  }
  assert.match(site, /^name: docs$/m);
  assert.match(site, /name: docs-build/);
  assert.match(deploy, /workflows: \[docs\]/);
  assert.match(deploy, /name: docs-preview #/);
  assert.match(deploy, /vars\.DOCS_DEPLOY_ENABLED/);
  assert.match(deploy, /secrets\.DOCS_STATE_TOKEN/);
  assert.match(deploy, /SITE_STATE_TOKEN: \$\{\{ secrets\.DOCS_STATE_TOKEN \}\}/); // env read by the infra unchanged
  const cfg = renameSiteConfig(JSON.parse(readFileSync(new URL("../delivery.config.json", import.meta.url), "utf8")), "docs");
  assert.ok(cfg.previews.requiredChecks.includes("docs-build"));
});

test("template names match delivery.config.json", () => {
  const cfg = JSON.parse(readFileSync(new URL("../delivery.config.json", import.meta.url), "utf8"));
  const n = cfg.site.name;
  assert.match(files[`${n}.yml`], new RegExp(`^name: ${n}$`, "m"));
  assert.match(files[`${n}.yml`], new RegExp(`name: ${n}-build`));
  assert.match(files[`${n}-deploy.yml`], new RegExp(`workflows: \\[${n}\\]`));
});
