// Minimal REST clients for GitHub and Cloudflare (fetch only, no dependency). Tokens are passed in,
// never logged; every error message goes through `redact` so a token cannot leak through an echo
// of a request or a response.

export type Fetch = typeof fetch;

export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join("***");
  return out;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// --- GitHub -------------------------------------------------------------------------------------

export interface GitHubClient {
  get<T>(path: string): Promise<T>;
  /** Follows `Link: rel="next"`; for endpoints returning an array or `{ [key]: [] }`. */
  list<T>(path: string, key?: string): Promise<T[]>;
  send<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T>;
}

export function github(token: string, { fetch: f = fetch, api = "https://api.github.com" } = {}): GitHubClient {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "webmcp-sdk-docs-infra",
  };
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await f(url, { method, headers: { ...headers, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(redact(`GitHub ${method} ${new URL(url).pathname} → ${res.status} ${text.slice(0, 200)}`, [token]), res.status);
    }
    return res;
  };
  const abs = (path: string) => (path.startsWith("https://") ? path : `${api}${path}`);
  return {
    async get(path) {
      return (await (await call("GET", abs(path))).json()) as never;
    },
    async list(path, key) {
      const items: unknown[] = [];
      let next: string | undefined = abs(path);
      for (let page = 0; next && page < 50; page++) {
        const res = await call("GET", next);
        const json = (await res.json()) as Record<string, unknown> | unknown[];
        items.push(...((key ? (json as Record<string, unknown[]>)[key] : json) as unknown[]));
        next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
        if (next && !next.startsWith(api)) throw new Error("unexpected pagination host");
      }
      return items as never;
    },
    async send(method, path, body) {
      return (await (await call(method, abs(path), body)).json()) as never;
    },
  };
}

// --- Cloudflare ---------------------------------------------------------------------------------

export interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

export interface CloudflareClient {
  /** Resolves the envelope, including unsuccessful ones; throws only on transport errors. */
  request<T>(method: "GET" | "PUT", path: string, body?: unknown): Promise<{ status: number; body: CloudflareEnvelope<T> | undefined }>;
}

export function cloudflare(token: string, { fetch: f = fetch, api = "https://api.cloudflare.com/client/v4" } = {}): CloudflareClient {
  return {
    async request(method, path, body) {
      try {
        const res = await f(`${api}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json = (await res.json().catch(() => undefined)) as CloudflareEnvelope<never> | undefined;
        return { status: res.status, body: json };
      } catch (error) {
        throw new Error(redact(`Cloudflare ${method} ${path}: ${String(error)}`, [token]));
      }
    },
  };
}

export const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export function cfErrors(body: CloudflareEnvelope<unknown> | undefined): string {
  return (body?.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ") || "no error detail";
}
