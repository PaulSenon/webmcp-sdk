import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkSiteDir } from "../src/site-dir.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function site(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "docs-site-"));
  dirs.push(root);
  for (const [path, content] of Object.entries({ "index.html": "<h1>hi</h1>", "404.html": "nf", ...files })) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

test("accepts a static export", () => {
  const report = checkSiteDir(site({ "_next/static/chunks/a.js": "1", "guide/index.html": "g" }));
  assert.equal(report.files, 4);
  assert.deepEqual(report.warnings, []);
});

test("requires index.html and 404.html", () => {
  const root = site();
  rmSync(join(root, "404.html"));
  assert.throws(() => checkSiteDir(root), /missing 404.html/);
  assert.throws(() => checkSiteDir(join(root, "nope")), /not found/);
});

test("refuses symlinks (their target would be uploaded)", () => {
  const root = site();
  symlinkSync("/etc/hosts", join(root, "hosts.txt"));
  assert.throws(() => checkSiteDir(root), /symlink/);
});

test("refuses credential-looking files anywhere", () => {
  for (const name of [".env", ".env.production", "sub/.npmrc", ".git/config", "key.pem"]) {
    assert.throws(() => checkSiteDir(site({ [name]: "x" })), /refusing to publish/, name);
  }
});

test("refuses control characters in names (log command forgery)", () => {
  assert.throws(() => checkSiteDir(site({ "a\n::error::x.html": "x" })), /control character/);
});

test("warns about routing files it overrides", () => {
  const report = checkSiteDir(site({ _headers: "/*\n  X: y", _redirects: "/a /b 301" }));
  assert.equal(report.warnings.length, 2);
  assert.equal(report.files, 4);
});
