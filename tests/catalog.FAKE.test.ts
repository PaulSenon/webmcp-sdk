import { deferred } from './helpers.js';
import { it, expect, vi, afterEach } from 'vitest';
import { createToolCatalog, defineTool, implementTool, registerTool, ToolError } from '../src/index.js';
import type { RegisteredTool } from '../src/index.js';
import { FakeModelContext } from './FAKE-model-context.js';
const contexts: ReturnType<typeof createToolCatalog>[] = [];
const catalog = (options?: Parameters<typeof createToolCatalog>[0]) => { const c = createToolCatalog(options); contexts.push(c); return c; };
afterEach(() => { contexts.splice(0).forEach(c => c.dispose()); vi.unstubAllGlobals(); });
const descriptor = (name: string, window = {} as Window, origin = 'https://example.com'): RegisteredTool => ({ name, description: 'Test', window, origin });
it('starts idle until discovery is requested', () => { expect(catalog().getSnapshot().status).toBe('idle'); });
it('reports unsupported when consumer context is absent', async () => { const c = catalog(); expect(await c.getTools()).toEqual([]); expect(c.getSnapshot().status).toBe('unsupported'); });
it('picks up a context installed after the first query', async () => {
  const c = catalog(); await c.getTools(); vi.stubGlobal('document', { modelContext: new FakeModelContext() });
  await c.getTools(); expect(c.getSnapshot().status).toBe('ready');
});
it('reports native discovery rejection', async () => {
  const context = new FakeModelContext(); context.getTools = async () => { throw new DOMException('no', 'SecurityError'); };
  const c = catalog({ modelContext: context }); expect(await c.getTools()).toEqual([]); expect(c.getSnapshot()).toMatchObject({ status: 'error', error: expect.any(Error) });
});
it('prefix validation', () => {
  expect(() => catalog({ namePrefix: 'bad.' })).toThrow(TypeError);
  expect(() => catalog({ namePrefix: 'x'.repeat(33) })).toThrow(RangeError);
});
it('adds the source tag and prefix to each name', async () => {
  const self = {} as Window; vi.stubGlobal('document', { defaultView: self });
  const context = new FakeModelContext(); context.getTools = async () => [descriptor('search', self)];
  expect((await catalog({ modelContext: context, namePrefix: 'p_' }).getTools())[0]).toMatchObject({ name: 'p_self__search', isSameDocument: true });
});
it('keeps names sticky when registration order changes', async () => {
  const context = new FakeModelContext(), frame = {} as Window;
  let tools = [descriptor('a.b', frame), descriptor('a_b', frame)]; context.getTools = async () => tools;
  const c = catalog({ modelContext: context }); await c.getTools(); tools = tools.reverse();
  expect((await c.getTools()).map(t => t.name)).toEqual(['f1__a_b_2', 'f1__a_b']);
});
it('assigns separate sources to same-origin frames', async () => {
  const context = new FakeModelContext(); context.getTools = async () => [descriptor('a'), descriptor('a')];
  expect((await catalog({ modelContext: context }).getTools()).map(t => t.name)).toEqual(['f1__a', 'f2__a']);
});
it('assigns a new source after a frame origin changes', async () => {
  const context = new FakeModelContext(), frame = {} as Window;
  let origin = 'https://first.example'; context.getTools = async () => [descriptor('a', frame, origin)];
  const c = catalog({ modelContext: context }); await c.getTools(); origin = 'https://second.example';
  expect((await c.getTools())[0]?.name).toBe('f2__a');
});
it('issues names independently in separate catalogs', async () => {
  const context = new FakeModelContext(); context.getTools = async () => [descriptor('a')];
  const c = catalog({ modelContext: context }); await c.getTools();
  expect((await catalog({ modelContext: context }).getTools())[0]?.name).toBe('f1__a');
});
it('unchanged snapshots preserve tools identity, descriptors update, version advances', async () => {
  const context = new FakeModelContext(); const d = descriptor('same'); context.getTools = async () => [{ ...d }];
  const c = catalog({ modelContext: context }); const first = await c.getTools(); const v = c.getSnapshot().version;
  expect(await c.getTools()).toBe(first); expect(c.getSnapshot().version).toBeGreaterThan(v);
  context.getTools = async () => [{ ...d, description: 'Changed' }]; expect(await c.getTools()).not.toBe(first);
});
it('latest query wins over an older query that finishes late', async () => {
  const context = new FakeModelContext(); const a = deferred<readonly RegisteredTool[]>(), b = deferred<readonly RegisteredTool[]>();
  let n = 0; context.getTools = () => ++n === 1 ? a.promise : b.promise;
  const c = catalog({ modelContext: context }); const first = c.getTools(), second = c.getTools();
  b.resolve([descriptor('new')]); await second; const snapshot = c.getSnapshot();
  a.resolve([descriptor('old')]); await first; expect(c.getSnapshot()).toBe(snapshot); expect(snapshot.tools[0]?.webmcpName).toBe('new');
});
it('does not invoke subscribers inline', async () => {
  const c = catalog({ modelContext: new FakeModelContext() }), listener = vi.fn(), ready = deferred<void>();
  c.subscribe(listener); c.subscribe(s => { if (s.status === 'ready') ready.resolve(); });
  expect(listener).not.toHaveBeenCalled(); await ready.promise;
});
it('coalesces toolchange bursts during a query', async () => {
  const context = new FakeModelContext(), first = deferred<readonly RegisteredTool[]>(), second = deferred<readonly RegisteredTool[]>();
  const started = deferred<void>(), repeated = deferred<void>(), ready = deferred<void>(); let calls = 0;
  context.getTools = () => { calls++; if (calls === 1) { started.resolve(); return first.promise; } repeated.resolve(); return second.promise; };
  const c = catalog({ modelContext: context }); c.subscribe(s => { if (s.status === 'ready' && calls === 2) ready.resolve(); });
  await started.promise; for (let i = 0; i < 10; i++) context.dispatchEvent(new Event('toolchange'));
  expect(calls).toBe(1); first.resolve([]); await repeated.promise; second.resolve([]); await ready.promise; expect(calls).toBe(2);
});
it('stops native listening when the last subscriber leaves', async () => {
  const context = new FakeModelContext(), remove = vi.spyOn(context, 'removeEventListener'), ready = deferred<void>();
  const c = catalog({ modelContext: context }); const off = c.subscribe(s => { if (s.status === 'ready') ready.resolve(); }), other = c.subscribe(() => {});
  await ready.promise; off(); expect(remove).not.toHaveBeenCalled(); other(); expect(remove).toHaveBeenCalledTimes(1);
  const query = vi.spyOn(context, 'getTools'); context.dispatchEvent(new Event('toolchange')); expect(query).not.toHaveBeenCalled();
});
it('compares origin sets by value', async () => {
  const context = new FakeModelContext(), query = vi.spyOn(context, 'getTools'), c = catalog({ modelContext: context, fromOrigins: ['a', 'b'] });
  await c.getTools(); c.update({ fromOrigins: ['b', 'a', 'a'] });
  // A following explicit query observes whether update scheduled extra native work.
  await c.getTools(); expect(query).toHaveBeenCalledTimes(2);
});
it('requeries an active catalog when origins change', async () => {
  const context = new FakeModelContext(), c = catalog({ modelContext: context }); await c.getTools();
  const queried = deferred<void>(); const query = vi.spyOn(context, 'getTools').mockImplementation(async () => { queried.resolve(); return []; });
  c.update({ fromOrigins: ['new'] }); await queried.promise; expect(query).toHaveBeenCalledExactlyOnceWith({ fromOrigins: ['new'] });
});
async function callable() {
  const context = new FakeModelContext(), lifetime = new AbortController();
  await registerTool(implementTool(defineTool({ name: 'call', description: 'Call' }), () => 7), { modelContext: context, signal: lifetime.signal });
  const c = catalog({ modelContext: context }), name = (await c.getTools())[0]!.name;
  return { context, lifetime, c, name };
}
it('returns a parsed successful value', async () => { const { c, name } = await callable(); expect(await c.callTool(name)).toEqual({ ok: true, value: 7 }); });
it('rejects a name the catalog never issued', async () => { expect(await catalog().callTool('never')).toMatchObject({ error: { kind: 'unknown_tool' } }); });
it.each([null, [], new Date(), 1, 'text', new (class Arguments {})()])('rejects non-plain arguments %s', async input => {
  const { c, name } = await callable(); expect(await c.callTool(name, input)).toMatchObject({ error: { kind: 'invalid_arguments' } });
});
it('maps a browser rejection to its DOMException name', async () => {
  const { c, name, context } = await callable(); context.executeTool = async () => { throw new DOMException('private', 'SecurityError'); };
  expect(await c.callTool(name)).toMatchObject({ error: { kind: 'rejected', domException: 'SecurityError' } });
});
it('reports unavailable when the native registration disappeared', async () => {
  const { c, name, lifetime } = await callable(); lifetime.abort();
  expect(await c.callTool(name)).toMatchObject({ error: { kind: 'unavailable' } });
});
it('retains ownership of issued names after disposal', async () => {
  const { c, name } = await callable(); c.dispose(); expect(c.isCatalogTool(name)).toBe(true); expect(await c.callTool(name)).toMatchObject({ error: { kind: 'unavailable' } });
});
it('returns a tool failure envelope as tool_failed', async () => {
  const context = new FakeModelContext();
  await registerTool(implementTool(defineTool({ name: 'business', description: 'Business' }), () => { throw new ToolError('Fix it', { code: 'FIX' }); }), { modelContext: context });
  const c = catalog({ modelContext: context }), name = (await c.getTools())[0]!.name;
  expect(await c.callTool(name)).toMatchObject({ error: { kind: 'tool_failed', message: 'Fix it', failure: { code: 'FIX' } } });
});
it('ignores an in-flight discovery after disposal', async () => {
  const context = new FakeModelContext(), gate = deferred<readonly RegisteredTool[]>(), started = deferred<void>();
  context.getTools = () => { started.resolve(); return gate.promise; };
  const c = catalog({ modelContext: context }), listener = vi.fn(); const off = c.subscribe(listener);
  await started.promise; const pending = c.getTools(); await started.promise; listener.mockClear(); c.dispose();
  gate.resolve([descriptor('late')]); await pending; expect(listener).not.toHaveBeenCalled(); expect(c.isCatalogTool('f1__late')).toBe(false); off();
});
it('retries missing context on an active update with unchanged origins', async () => {
  const c = catalog(); await c.getTools();
  const context = new FakeModelContext(), queried = deferred<void>();
  const getTools = context.getTools.bind(context);
  context.getTools = async () => { queried.resolve(); return getTools(); };
  vi.stubGlobal('document', { modelContext: context });
  c.update({}); await queried.promise;
  await vi.waitFor(() => expect(c.getSnapshot().status).toBe('ready'));
});
it('only stores new origins until an idle catalog is queried', async () => {
  const context = new FakeModelContext(), query = vi.spyOn(context, 'getTools');
  const c = catalog({ modelContext: context }); c.update({ fromOrigins: ['new'] });
  expect(c.getSnapshot().status).toBe('idle');
  await c.getTools(); expect(query).toHaveBeenCalledExactlyOnceWith({ fromOrigins: ['new'] });
});
it('calls a replaced handler by name without querying again', async () => {
  const context = new FakeModelContext(), owner = new AbortController();
  const d = defineTool({ name: 'replace', description: 'Replace' });
  await registerTool(implementTool(d, () => 1), { modelContext: context, signal: owner.signal });
  const c = catalog({ modelContext: context }), name = (await c.getTools())[0]!.name;
  const query = vi.spyOn(context, 'getTools'); owner.abort();
  await registerTool(implementTool(d, () => 2), { modelContext: context });
  expect(await c.callTool(name)).toEqual({ ok: true, value: 2 }); expect(query).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid maxNameLength %s', maxNameLength => {
  expect(() => catalog({ maxNameLength })).toThrow(RangeError);
});
it('reports discovery error when the name budget cannot fit a tool', async () => {
  const context = new FakeModelContext(); context.getTools = async () => [descriptor('tool')];
  const c = catalog({ modelContext: context, maxNameLength: 1 });
  expect(await c.getTools()).toEqual([]); expect(c.getSnapshot().status).toBe('error');
});
it('contains subscriber exceptions while notifying other subscribers', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const c = catalog({ modelContext: new FakeModelContext() }), notified = deferred<void>();
    c.subscribe(() => { throw Error('subscriber'); }); c.subscribe(s => { if (s.status === 'ready') notified.resolve(); });
    await notified.promise; expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); }
});
it('keeps malformed JSON separate from native rejection mapping', async () => {
  const context = new FakeModelContext(); context.getTools = async () => [descriptor('bad')]; context.executeTool = async () => 'invalid';
  const c = catalog({ modelContext: context }), name = (await c.getTools())[0]!.name;
  expect(await c.callTool(name)).toEqual({ ok: false, error: { kind: 'rejected', domException: 'SyntaxError', message: 'The tool returned a result that is not valid JSON.' } });
});
it.each([{ getTools() {} }, { registerTool() {} }, { getTools() {}, executeTool: 1 }])('detects incomplete default context halves', async modelContext => {
  vi.stubGlobal('document', { modelContext });
  const c = catalog(); expect(await c.getTools()).toEqual([]); expect(c.getSnapshot().status).toBe('unsupported');
  if (!('registerTool' in modelContext)) expect(await registerTool(implementTool(defineTool({ name: 'x', description: 'X' }), () => 1))).toBe('unsupported');
});
