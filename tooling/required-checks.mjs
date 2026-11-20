// Ruleset required checks (tooling/setup-github.mjs). Pure + a workflow reader, unit-tested.
// = previews.requiredChecks (gate deploys too) + previews.prOnlyChecks (PR-only: required by the
// ruleset, never gate deploys; default ["dependency-review"]). Every one must be produced by a job
// of .github/workflows, or the ruleset would wait forever for a check that never reports and
// block every PR (found by WebMCP, which has no `changeset` job).
//
// Matrix jobs (v0.3.3, Better Upload's `e2e (${{ matrix.browser }})`): names are expanded over a
// STATIC matrix (lists, `exclude`, `include`), as GitHub does. Anything else — a dynamic matrix
// (`fromJSON(...)`), a non-matrix expression, an object-valued key — is reported as UNVERIFIABLE:
// it never silently satisfies a required check.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const DEFAULT_PR_ONLY_CHECKS = ["dependency-review"];

export function requiredChecks(config) {
  const prOnly = config.previews.prOnlyChecks ?? DEFAULT_PR_ONLY_CHECKS;
  if (!Array.isArray(prOnly) || !prOnly.every((n) => typeof n === "string" && n.length > 0)) throw new Error("previews.prOnlyChecks must list check names");
  return [...new Set([...config.previews.requiredChecks, ...prOnly])];
}

const isScalar = (v) => ["string", "number", "boolean"].includes(typeof v);
const matches = (combo, partial) => Object.entries(partial).every(([k, v]) => combo[k] === v);

/**
 * GitHub's static matrix expansion: cartesian product of the list keys, minus `exclude` entries,
 * then `include` entries (merged into every combination they do not contradict on original keys,
 * otherwise added as new combinations). Returns undefined when the matrix is not static.
 */
export function expandMatrix(matrix) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) return undefined; // e.g. "${{ fromJSON(...) }}"
  const keys = Object.keys(matrix).filter((k) => k !== "include" && k !== "exclude");
  for (const k of keys) if (!Array.isArray(matrix[k])) return undefined; // a key itself computed by an expression
  for (const list of ["include", "exclude"]) if (matrix[list] !== undefined && !Array.isArray(matrix[list])) return undefined;
  let combos = keys.length ? [{}] : [];
  for (const k of keys) combos = combos.flatMap((c) => matrix[k].map((v) => ({ ...c, [k]: v })));
  for (const ex of matrix.exclude ?? []) combos = combos.filter((c) => !matches(c, ex));
  for (const inc of matrix.include ?? []) {
    const original = Object.fromEntries(Object.entries(inc).filter(([k]) => keys.includes(k)));
    const targets = combos.filter((c) => matches(c, original));
    // GitHub: merged into every combination whose original values it does not overwrite (an entry
    // with only new keys merges into all); if it fits none, it becomes a new combination.
    if (keys.length && targets.length) targets.forEach((c) => Object.assign(c, inc));
    else combos.push({ ...inc });
  }
  return combos;
}

const EXPR = /\$\{\{\s*([^}]*?)\s*\}\}/g;

/** One job's check names, or the reason they cannot be computed statically. */
export function jobCheckNames(id, job) {
  const raw = typeof job?.name === "string" ? job.name : undefined;
  const matrix = job?.strategy?.matrix;
  if (matrix === undefined) {
    if (raw?.includes("${{")) return { unverifiable: `name ${JSON.stringify(raw)} uses an expression outside a matrix` };
    return { names: [raw ?? id] };
  }
  const combos = expandMatrix(matrix);
  if (!combos) return { unverifiable: "dynamic matrix (not a static list): its check names cannot be known before it runs" };
  const names = [];
  for (const combo of combos) {
    if (raw === undefined) {
      // GitHub's default check name for a matrix job: "<id> (<values in key order>)"
      const values = Object.values(combo);
      if (!values.every(isScalar)) return { unverifiable: "matrix with object values: default check names cannot be computed" };
      names.push(values.length ? `${id} (${values.join(", ")})` : id);
      continue;
    }
    let unknown;
    const name = raw.replace(EXPR, (all, expr) => {
      const m = /^matrix\.([A-Za-z_][A-Za-z0-9_-]*)$/.exec(expr);
      if (!m || !(m[1] in combo) || !isScalar(combo[m[1]])) {
        unknown = expr;
        return all;
      }
      return String(combo[m[1]]);
    });
    if (unknown !== undefined) return { unverifiable: `name ${JSON.stringify(raw)}: \${{ ${unknown} }} is not a static scalar matrix value` };
    names.push(name);
  }
  return { names };
}

/** Check names the workflows can report, plus the jobs whose names cannot be known statically. */
export function workflowChecks(dir) {
  const names = new Set();
  const unverifiable = [];
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const wf = parse(readFileSync(join(dir, f), "utf8")) ?? {};
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      const r = jobCheckNames(id, job);
      if (r.names) r.names.forEach((n) => names.add(n));
      else unverifiable.push(`${f} job ${id}: ${r.unverifiable}`);
    }
  }
  return { names, unverifiable };
}

/** Back-compat: names only. */
export const workflowCheckNames = (dir) => workflowChecks(dir).names;

export function missingChecks(checks, available) {
  return checks.filter((c) => !available.has(c));
}

/** The error setup-github throws: missing checks, with the unverifiable jobs that may explain them. */
export function missingChecksError(missing, unverifiable) {
  if (!missing.length) return undefined;
  const why = unverifiable.length ? `\nJobs whose check names cannot be verified statically (they never count as present):\n  - ${unverifiable.join("\n  - ")}` : "";
  return `required check(s) with no job in .github/workflows: ${missing.join(", ")} — fix previews.requiredChecks / previews.prOnlyChecks, or give those jobs static names${why}`;
}
