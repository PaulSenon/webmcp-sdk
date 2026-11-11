/** Real Chromium, official POLYFILL. Native WebMCP is not tested. */
import { beforeAll, afterEach, expect, it } from 'vitest';
import { installWebMCP } from '@w3c/webmcp-polyfill';
import polyfillSource from '../../node_modules/@w3c/webmcp-polyfill/dist/polyfill.js?raw';
import { z } from 'zod';
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
it('round trip: register → discover → call; schema validation', async () => {
  await registerTool(implementTool(defineTool({ name: 'round_trip', description: 'Adds one', input: z.object({ n: z.number() }), output: z.number() }), ({ n }) => n + 1), { signal: lifetime().signal });
  const c = catalog(); const tools = await c.getTools(); const t = tools.find(t => t.webmcpName === 'round_trip')!;
  expect(t.name).toBe('self__round_trip'); expect(await c.callTool(t.name, { n: 2 })).toEqual({ ok: true, value: 3 });
  expect(await c.callTool(t.name, { n: 'wrong' })).toMatchObject({ error: { kind: 'tool_failed', failure: { kind: 'input_invalid' } } });
  // Published 0.1.0 drops outputSchema, although SDK publishes it.
  expect(t.outputSchema).toBeUndefined();
});
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
it('unregister leaves callback signal live and delivers its late result', async () => {
  const owner = lifetime(), started = deferred<AbortSignal>(), finish = deferred<number>();
  await registerTool(implementTool(defineTool({ name: 'unregister_running', description: 'Wait' }), (_, { signal }) => { started.resolve(signal); return finish.promise; }), { signal: owner.signal });
  const c = catalog(); const t = (await c.getTools()).find(t => t.webmcpName === 'unregister_running')!;
  const result = c.callTool(t.name); const signal = await started.promise;
  owner.abort(); expect(signal.aborted).toBe(false);
  expect((await c.getTools()).some(t => t.webmcpName === 'unregister_running')).toBe(false);
  finish.resolve(17); expect(await result).toEqual({ ok: true, value: 17 }); expect(signal.aborted).toBe(false);
});
it('same-origin iframe is a second source f1', async () => {
  const frame = document.createElement('iframe');
  const ready = deferred<void>();
  const token = `frame-ready-${Math.random()}`;
  const onMessage = (event: MessageEvent) => { if (event.source === frame.contentWindow && event.data === token) ready.resolve(); };
  window.addEventListener('message', onMessage);
  frame.srcdoc = `<script>${polyfillSource.replaceAll('</script', '<\\/script')}<\/script><script>
    document.modelContext.registerTool({ name: 'frame_tool', description: 'Frame tool', execute: async () => 'frame' })
      .then(() => parent.postMessage(${JSON.stringify(token)}, '*'));
  <\/script>`;
  document.body.append(frame);
  try {
    await ready.promise;
    const c = catalog(); const t = (await c.getTools()).find(t => t.webmcpName === 'frame_tool')!;
    expect(t.name).toBe('f1__frame_tool'); expect(t.isSameDocument).toBe(false);
    expect(await c.callTool(t.name)).toEqual({ ok: true, value: 'frame' });
  } finally { window.removeEventListener('message', onMessage); frame.remove(); }
});
