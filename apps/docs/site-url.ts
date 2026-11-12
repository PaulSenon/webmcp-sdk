// Shared by vite.config.ts (build-time constant) and the build scripts. No dependencies.
export const DEFAULT_SITE_URL = "http://localhost:4321";

/**
 * Validates SITE_URL: an absolute http(s) origin. The site is served at the root path, so a
 * path, query or fragment is an error rather than a silent base path.
 */
export function resolveSiteUrl(value: string | undefined): string {
  if (value === undefined || value === "") return DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SITE_URL is not a URL: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`SITE_URL must be http(s): ${value}`);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(`SITE_URL must be a bare origin such as https://docs.example.com (the site is served at /): ${value}`);
  }
  return url.origin;
}
