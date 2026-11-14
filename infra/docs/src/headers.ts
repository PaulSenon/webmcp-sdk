// Response headers for the docs site, rendered as a Cloudflare `_headers` file and passed to the
// Worker's asset config (`assets.headers`). That config value overrides any `_headers` file the
// site build might ship, so headers are owned by this reviewed package, not by the site content.
// Cloudflare applies `_headers` rules only to static-asset responses, which is all this Worker
// serves (assets-only, no script). Format and limits (100 rules, 2,000 chars per line):
// https://developers.cloudflare.com/workers/static-assets/headers/

/**
 * Content-Security-Policy for a fully static, prerendered docs site (Fumadocs on TanStack Start
 * with Vite, apps/docs). Every resource is same-origin; nothing is loaded from third parties.
 *
 * `script-src 'unsafe-inline'` is required because TanStack Start inlines its serialized router
 * state (hydration data) in every prerendered page, and the theme switcher an anti-flash script;
 * a static site cannot add per-request nonces. Module chunks, `modulepreload` links, the search
 * index (/api/search.json) and the client-navigation data (/__tsr/staticServerFnCache/*.json) are
 * all same-origin, and the client bundle uses no eval. The policy still
 * blocks every external script origin, plugins, framing, `<base>` hijacking, and exfiltration via
 * fetch/XHR/WebSocket to other origins (connect-src). A hash-based policy is a proposed follow-up
 * (docs/docs-deploy.md, "Deferred").
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Headers sent on every response. Order is the order in the generated file. */
export const REVISION_HEADER = "X-Docs-Revision";

/**
 * Headers sent on every response. Order is the order in the generated file. `revision`
 * (`pr-6@abc1234`) is set on non-production stages so anyone can see what staging serves.
 */
export function securityHeaders({ indexable, revision }: { indexable: boolean; revision?: string }): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
    // .dev is HSTS-preloaded already; this matters once a custom domain is attached.
    // No `preload`: that is a separate, hard-to-undo decision for the domain owner.
    ["Strict-Transport-Security", "max-age=63072000; includeSubDomains"],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", PERMISSIONS_POLICY],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
  ];
  if (!indexable) headers.push(["X-Robots-Tag", "noindex, nofollow"]);
  if (revision !== undefined) {
    if (indexable) throw new Error("the revision header is for non-production stages only");
    if (!/^(main|pr-[1-9][0-9]{0,6})@[0-9a-f]{7}$/.test(revision)) throw new Error("invalid revision label");
    headers.push([REVISION_HEADER, revision]);
  }
  return headers;
}

/**
 * Path patterns whose files are content-hashed by the build and therefore safe to cache forever.
 * Vite (TanStack Start build of apps/docs) puts every hashed chunk, stylesheet and font under
 * /assets/; nothing else is written there.
 *
 * Not /__tsr/*: the names of TanStack's static server-function results hash the function and its
 * arguments, not the content, so a redeploy changes the file behind the same URL.
 */
export const IMMUTABLE_PATHS = ["/assets/*"] as const;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// HTML and every other un-hashed file keep Cloudflare's default
// `Cache-Control: public, max-age=0, must-revalidate` plus an ETag, so a deploy is visible at once.

const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const MAX_LINE = 2000;
const MAX_RULES = 100;

function rule(pattern: string, headers: Array<[string, string]>): string {
  if (!pattern.startsWith("/")) throw new Error(`header rule must be a path: ${pattern}`);
  const lines = [pattern];
  for (const [name, value] of headers) {
    if (!HEADER_NAME.test(name)) throw new Error(`invalid header name ${JSON.stringify(name)}`);
    if (/[\r\n]/.test(value)) throw new Error(`header ${name} contains a line break`);
    lines.push(`  ${name}: ${value}`);
  }
  for (const line of lines) {
    if (line.length > MAX_LINE) throw new Error(`_headers line over ${MAX_LINE} characters: ${line.slice(0, 40)}…`);
  }
  return lines.join("\n");
}

/** The complete `_headers` file for a stage. */
export function renderHeadersFile(options: { indexable: boolean; revision?: string }): string {
  const rules = [
    rule("/*", securityHeaders(options)),
    ...IMMUTABLE_PATHS.map((path) => rule(path, [["Cache-Control", IMMUTABLE_CACHE_CONTROL]])),
  ];
  if (rules.length > MAX_RULES) throw new Error("too many _headers rules");
  return `# Generated by infra/docs/src/headers.ts. Do not edit; site-provided _headers are ignored.\n${rules.join("\n")}\n`;
}
