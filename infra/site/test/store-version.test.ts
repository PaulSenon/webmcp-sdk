// v0.3.5 (first real CI production deploy): the preflight must compare the store against the
// CLOUDFLARE state store version of the installed @alchemy.run/cloudflare, read strictly.
import assert from "node:assert/strict";
import { test } from "node:test";
import { storeDecision } from "../src/isolation.ts";
import { installedStoreVersion, parseStoreVersion } from "../src/store-version.ts";

test("parse: exactly one declaration, else refuse", () => {
  assert.equal(parseStoreVersion('import x from "y";\nexport const STATE_STORE_VERSION = 8;\nconst a = STATE_STORE_VERSION;\n'), 8);
  assert.throws(() => parseStoreVersion("export const OTHER = 8;\n"), /found 0/);
  assert.throws(() => parseStoreVersion("export const STATE_STORE_VERSION = 8;\nexport const STATE_STORE_VERSION = 9;\n"), /found 2/);
  assert.throws(() => parseStoreVersion("// export const STATE_STORE_VERSION = 8;\n"), /found 0/); // commented out
  assert.throws(() => parseStoreVersion("export const STATE_STORE_VERSION = getVersion();\n"), /found 0/);
  assert.throws(() => parseStoreVersion("export const STATE_STORE_VERSION = 0;\n"), /found 1/);
});

test("installed @alchemy.run/cloudflare declares v8 — what the real stores serve (GET /version → {\"version\":8})", () => {
  // If an Alchemy upgrade changes this, the stores must be upgraded by the owner's bootstrap
  // BEFORE CI deploys with the new version: update this expectation deliberately, never blindly.
  const { version, packageVersion } = installedStoreVersion();
  assert.equal(packageVersion, "2.0.0-beta.85");
  assert.equal(version, 8);
  assert.deepEqual(storeDecision({ version: 8, authorized: true }, version, "x-state"), { ok: true, notes: [] });
  assert.match((storeDecision({ version: 5, authorized: true }, version, "x-state") as { reason: string }).reason, /serves state API v5.*expects v8.*re-run the bootstrap/);
});

test("unresolvable package: fail closed with the requested message", () => {
  assert.throws(() => installedStoreVersion("file:///nonexistent/dir/x.js"), /cannot determine the Cloudflare state store version of @alchemy\.run\/cloudflare .*; refusing/);
});
