// CI helpers for the docs deploy (.github/workflows/docs.yml). Inputs come from the environment
// only, never from argv interpolation in YAML. Outputs go to $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY.
//
//   node infra/docs/scripts/cli.ts stage        PR_NUMBER (optional)      -> stage=pr-<n> | production
//   node infra/docs/scripts/cli.ts url          STAGE, WORKERS_SUBDOMAIN  -> url=<https://…/>
//   node infra/docs/scripts/cli.ts check-site   DOCS_SITE_DIR
//   node infra/docs/scripts/cli.ts headers      STAGE                     -> prints the _headers file
//   node infra/docs/scripts/cli.ts smoke        SMOKE_URL, DOCS_SITE_DIR, STAGE
import { appendFileSync } from "node:fs";
import { renderHeadersFile } from "../src/headers.ts";
import { checkSiteDir } from "../src/site-dir.ts";
import { runSmoke } from "../src/smoke.ts";
import { isIndexable, previewStage, stageKind, workersDevUrl } from "../src/stage.ts";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const output = (key: string, value: string) => {
  if (/[\r\n]/.test(value)) throw new Error(`output ${key} contains a line break`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
};
const summary = (markdown: string) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
};

const commands: Record<string, () => Promise<void> | void> = {
  stage() {
    // pull_request -> pr-<n>; workflow_dispatch with a PR number -> pr-<n>; otherwise production.
    const pr = process.env.PR_NUMBER ?? "";
    const stage = pr ? previewStage(pr) : "production";
    if (!pr && process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
      throw new Error(`production is deployed from refs/heads/main only, not ${process.env.GITHUB_REF}`);
    }
    output("stage", stage);
  },
  url() {
    output("url", workersDevUrl(env("STAGE"), env("WORKERS_SUBDOMAIN")));
  },
  "check-site"() {
    const report = checkSiteDir(env("DOCS_SITE_DIR"));
    for (const warning of report.warnings) console.log(`::warning::${warning}`);
    console.log(`site ok: ${report.files} files, ${(report.bytes / 1024 / 1024).toFixed(1)} MiB`);
  },
  headers() {
    stageKind(env("STAGE"));
    process.stdout.write(renderHeadersFile({ indexable: isIndexable(env("STAGE")) }));
  },
  async smoke() {
    const stage = env("STAGE");
    const url = env("SMOKE_URL");
    const result = await runSmoke({
      url,
      siteDir: env("DOCS_SITE_DIR"),
      indexable: isIndexable(stage),
      timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000),
      log: (line) => console.log(line),
    });
    for (const check of result.checks) console.log(`ok  ${check}`);
    for (const warning of result.warnings) console.log(`::warning::${warning}`);
    for (const failure of result.failures) console.log(`::error::${failure}`);
    summary(
      [
        `### Smoke test (${stage}): ${result.ok ? "passed" : "FAILED"}`,
        "",
        `URL: ${url}`,
        "",
        ...result.checks.map((c) => `- ✅ ${c}`),
        ...result.warnings.map((w) => `- ⚠️ ${w}`),
        ...result.failures.map((f) => `- ❌ ${f}`),
      ].join("\n"),
    );
    if (!result.ok) process.exitCode = 1;
  },
};

const name = process.argv[2] ?? "";
const command = commands[name];
if (!command) {
  console.error(`usage: cli.ts <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
try {
  await command();
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
