import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_SECURITY_POLICY, IMMUTABLE_CACHE_CONTROL, renderHeadersFile, securityHeaders } from "../src/headers.ts";

test("CSP keeps every resource same-origin and blocks framing, plugins and <base>", () => {
  const directives = new Map(
    CONTENT_SECURITY_POLICY.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values.join(" ")] as const;
    }),
  );
  assert.equal(directives.get("default-src"), "'self'");
  assert.equal(directives.get("connect-src"), "'self'");
  assert.equal(directives.get("object-src"), "'none'");
  assert.equal(directives.get("base-uri"), "'none'");
  assert.equal(directives.get("frame-ancestors"), "'none'");
  assert.ok(directives.has("upgrade-insecure-requests"));
  // No third-party script origin, no eval.
  assert.equal(directives.get("script-src"), "'self' 'unsafe-inline'");
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval|https?:\/\/|\*/);
});

test("previews are noindex, production is not", () => {
  const names = (indexable: boolean) => securityHeaders({ indexable }).map(([n]) => n);
  assert.ok(names(false).includes("X-Robots-Tag"));
  assert.ok(!names(true).includes("X-Robots-Tag"));
});

test("_headers file: one global rule plus immutable hashed assets, within Cloudflare limits", () => {
  const file = renderHeadersFile({ indexable: true });
  assert.match(file, /^# Generated/);
  assert.match(file, /\n\/\*\n {2}Content-Security-Policy: default-src 'self';/);
  assert.match(file, /\n\/_next\/static\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n$/);
  assert.equal(IMMUTABLE_CACHE_CONTROL, "public, max-age=31536000, immutable");
  for (const line of file.split("\n")) assert.ok(line.length <= 2000);
  const rules = file.split("\n").filter((l) => l.startsWith("/"));
  assert.deepEqual(rules, ["/*", "/_next/static/*"]);
  assert.doesNotMatch(file, /X-Robots-Tag/);
  assert.match(renderHeadersFile({ indexable: false }), /X-Robots-Tag: noindex, nofollow/);
});
