# Browser examples and integration tests

From a clean clone (Node 24 and pnpm 10):

```sh
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:all
```

Playwright 1.59.1 automatically reuses its matching cached Chromium (revision
1217). Browser installation is a setup step; deterministic tests use no network
outside two local fixture origins and need no keys. The configured pnpm release
age is respected. `pnpm check` also typechecks fixtures and test configs. Vite 7.3.5 compiles the SDK TypeScript sources and fixture apps.

Playwright owns both Vite processes and shuts them down on completion or failure.
It refuses to reuse existing servers. Defaults are `http://localhost:4173` and
`http://127.0.0.1:4174`; override the ports with `WEBMCP_PORT` and
`WEBMCP_FRAME_PORT`. Use distinct ports. Traces and other artifacts stay in
ignored `test-results/` (reports in `playwright-report/`). No CI workflow is needed.

| Scenario | Evidence |
| --- | --- |
| Same document | `registerTools` / `registerTool`, `getTools`, `callTool`, validated input/output, failure envelopes |
| Unregister | Future availability disappears; explicitly gated in-flight call completes with a live signal (D16) |
| Same-origin frame | SDK publisher in another document, source `f1`, round trip and stable name after removal/re-registration |
| Exposed cross-origin frame | `allow="tools"`, `exposedTo` and `fromOrigins` allow discovery/call; omitting `fromOrigins` hides it |
| Unexposed cross-origin frame | Even with delegation and `fromOrigins`, the unexposed tool is absent (with a working local positive control) |
| React StrictMode | Separate publisher/consumer, current handler after state change, unchanged registration count, unmount cleanup, no published duplicate errors |
| AI SDK deterministic loop | `MockLanguageModelV4` from installed `ai/test`, actual `generateText`, catalog-issued name, `isCatalogTool`, `callTool`, result fed back into a second model turn |
| Real provider, optional | Same loop; provider executes in Node, never exposing a key to the fixture |

Fixtures are small examples: `publisher.html`, `agent.html`, `frame.html` and
`react.html`. Each test uses a fresh browser context. Frame readiness and running
calls use explicit state/gates, not sleeps. The AI example uses `generateText`
rather than `useChat`, so it needs no server route or simulated chat transport.

Default tests assert native `document.modelContext` is absent before loading the
official `@w3c/webmcp-polyfill` 0.1.0 in **each document**. Output validation runs
at the publisher; this polyfill drops advertised `outputSchema`. Cross-origin
assertions describe this polyfill's delegation/exposure enforcement. The SDK
adds no security layer. These are SDK integration tests, not platform conformance.

```sh
pnpm test:browser        # one additional polyfill caller-cancellation integration
pnpm test:react18        # existing React unit/SSR suite using pnpm aliases
pnpm test:e2e:native     # sets WEBMCP_NATIVE=1; same eight scenarios
WEBMCP_NATIVE=1 pnpm exec playwright test --project=native
WEBMCP_NATIVE_CHANNEL=chrome pnpm test:e2e:native
```

Native uses `--enable-features=WebMCP`. Chrome's
[WebMCP docs](https://developer.chrome.com/docs/ai/webmcp) name
`chrome://flags/#enable-webmcp-testing`; Chromium's
[flag mapping](https://github.com/chromium/chromium/blob/main/chrome/browser/about_flags.cc)
maps it to `blink::features::kWebMCP`. Every native scenario first checks
`document.modelContext` without importing the polyfill. Absence skips the test
with a reason, never falls back. An incompatible present API fails the scenario.
On this machine Chrome for Testing **147.0.7727.15** lacked that entry point;
all eight native tests skipped. No native behavior was verified.

The real-provider scenario is **skipped**, not passed, unless `OPENAI_API_KEY`
is in the runner environment. It then makes real network requests and may cost
money. The key stays in Node memory. `WEBMCP_MODEL` overrides the default
`gpt-4.1-mini`. No `.env` is loaded or written. Without a key all deterministic
browser traffic is local; the provider package is only a devDependency.

Remaining gaps: native conformance, other browser engines, actual frame navigation
and unload/caller unload, and provider behavior without an opt-in real run.
