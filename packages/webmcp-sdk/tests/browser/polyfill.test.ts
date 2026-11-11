/** Real Chromium, official POLYFILL. Native WebMCP is not tested. */
import { beforeAll, afterEach, expect, it } from 'vitest';
import { installWebMCP } from '@w3c/webmcp-polyfill';
import { createToolCatalog, defineTool, implementTool, registerTool } from '../../src/index.js';
import { deferred } from '../helpers.js';
const controllers: AbortController[] = [];
const catalogs: ReturnType<typeof createToolCatalog>[] = [];
const lifetime = () => { const c = new AbortController(); controllers.push(c); return c; };
const catalog = () => { const c = createToolCatalog(); catalogs.push(c); return c; };
beforeAll(() => {
  // Fail rather than accidentally label native coverage as polyfill coverage.
  expect('modelContext' in Document.prototype).toBe(false);
  installWebMCP();
});
afterEach(() => { controllers.splice(0).forEach(c => c.abort()); catalogs.splice(0).forEach(c => c.dispose()); });
it('caller abort rejects and then aborts the callback signal', async () => {
  const started = deferred<AbortSignal>(), cancelled = deferred<void>(), finish = deferred<number>();
  await registerTool(implementTool(defineTool({ name: 'caller_abort', description: 'Wait' }), (_, { signal }) => {
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true }); started.resolve(signal); return finish.promise;
  }), { signal: lifetime().signal });
  const c = catalog(); const t = (await c.getTools()).find(t => t.webmcpName === 'caller_abort')!;
  const caller = new AbortController(); const result = c.callTool(t.name, {}, { signal: caller.signal });
  const signal = await started.promise; caller.abort();
  expect(await result).toMatchObject({ error: { kind: 'rejected', domException: 'AbortError' } });
  await cancelled.promise; expect(signal.aborted).toBe(true); finish.resolve(1);
});
