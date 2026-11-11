import { it, expect, vi, afterEach } from 'vitest';
import { createToolCatalog, defineTool, implementTool, registerTool, ToolError } from '../src/index.js';
import type { RegisteredTool } from '../src/index.js';
import { FakeModelContext, deferred } from './FAKE-model-context.js';
const contexts: ReturnType<typeof createToolCatalog>[] = [];
const catalog = (options?: Parameters<typeof createToolCatalog>[0]) => { const c = createToolCatalog(options); contexts.push(c); return c; };
afterEach(() => { contexts.splice(0).forEach(c => c.dispose()); vi.unstubAllGlobals(); });
const descriptor = (name: string, window = {} as Window, origin = 'https://example.com'): RegisteredTool => ({ name, description: 'Test', window, origin });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
it('lazy, unsupported, late installation and discovery errors', async () => {
  const c = catalog(); expect(c.getSnapshot().status).toBe('idle'); expect(await c.getTools()).toEqual([]); expect(c.getSnapshot().status).toBe('unsupported');
  const context = new FakeModelContext(); vi.stubGlobal('document', { modelContext: context });
  await c.getTools(); expect(c.getSnapshot().status).toBe('ready');
  context.getTools = async () => { throw new DOMException('no', 'SecurityError'); };
  expect(await c.getTools()).toEqual([]); expect(c.getSnapshot()).toMatchObject({ status: 'error', error: expect.any(Error) });
});
it('prefix validation', () => {
  expect(() => catalog({ namePrefix: 'bad.' })).toThrow(TypeError);
  expect(() => catalog({ namePrefix: 'x'.repeat(33) })).toThrow(RangeError);
});
it('tags, sticky names, collisions, truncation, same-origin frames, origin changes, instance ownership', async () => {
  const self = {} as Window, frame = {} as Window;
  vi.stubGlobal('document', { defaultView: self });
  const context = new FakeModelContext();
  let descriptors = [descriptor('a.b', self), descriptor('a_b', self), descriptor('a!b', self), descriptor('x'.repeat(100), frame)];
  context.getTools = async () => descriptors;
  const c = catalog({ modelContext: context, namePrefix: 'p_', maxNameLength: 24 });
  const first = await c.getTools();
  expect(first.map(t => t.name)).toEqual(['p_self__a_b', 'p_self__a_b_2', 'p_self__a_b_3', 'p_f1__' + 'x'.repeat(18)]);
  expect(first[0]?.isSameDocument).toBe(true); expect(first[3]?.isSameDocument).toBe(false);
  descriptors = []; await c.getTools(); expect(c.isCatalogTool(first[0]!.name)).toBe(true);
  descriptors = [descriptor('a_b', self), descriptor('a.b', self)];
  expect((await c.getTools()).map(t => t.name)).toEqual(['p_self__a_b_2', 'p_self__a_b']);
  descriptors = [descriptor('a_b', frame, 'https://new.example')]; expect((await c.getTools())[0]?.name).toBe('p_f2__a_b');
  const independent = catalog({ modelContext: context }); expect((await independent.getTools())[0]?.name).toBe('f1__a_b');
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
  await Promise.resolve(); b.resolve([descriptor('new')]); await second; const snapshot = c.getSnapshot();
  a.resolve([descriptor('old')]); await first; expect(c.getSnapshot()).toBe(snapshot); expect(snapshot.tools[0]?.webmcpName).toBe('new');
});
it('subscribes without immediate callback, coalesces bursts, last unsubscribe stops listening', async () => {
  const context = new FakeModelContext(); const gates = [deferred<readonly RegisteredTool[]>(), deferred<readonly RegisteredTool[]>()];
  let calls = 0; context.getTools = () => gates[calls++]!.promise;
  const add = vi.spyOn(context, 'addEventListener'), remove = vi.spyOn(context, 'removeEventListener');
  const c = catalog({ modelContext: context }); const listener = vi.fn(); const off = c.subscribe(listener); const off2 = c.subscribe(() => {});
  expect(listener).not.toHaveBeenCalled(); await Promise.resolve();
  for (let i = 0; i < 10; i++) context.dispatchEvent(new Event('toolchange'));
  expect(calls).toBe(1); gates[0]!.resolve([]); await tick(); expect(calls).toBe(2);
  gates[1]!.resolve([]); await tick(); expect(calls).toBe(2); expect(add).toHaveBeenCalledTimes(1);
  off(); expect(remove).not.toHaveBeenCalled(); off2(); expect(remove).toHaveBeenCalledTimes(1);
  context.dispatchEvent(new Event('toolchange')); await tick(); expect(calls).toBe(2);
});
it('origin updates compare sorted sets by value and re-query only on change', async () => {
  const context = new FakeModelContext(); const spy = vi.spyOn(context, 'getTools'); const c = catalog({ modelContext: context, fromOrigins: ['b', 'a'] });
  await c.getTools(); c.update({ fromOrigins: ['a', 'b', 'a'] }); await tick(); expect(spy).toHaveBeenCalledTimes(1);
  c.update({ fromOrigins: ['c'] }); await tick(); expect(spy).toHaveBeenCalledTimes(2); expect(spy).toHaveBeenLastCalledWith({ fromOrigins: ['c'] });
});
it('routes ok, unknown, unavailable, invalid arguments, tool failure, native rejection, malformed JSON', async () => {
  const context = new FakeModelContext(); const lifetime = new AbortController();
  await registerTool(implementTool(defineTool({ name: 'call', description: 'c' }), () => 7), { modelContext: context, signal: lifetime.signal });
  const c = catalog({ modelContext: context });
  expect(await c.callTool('never')).toMatchObject({ error: { kind: 'unknown_tool' } });
  const name = (await c.getTools())[0]!.name;
  expect(await c.callTool(name)).toEqual({ ok: true, value: 7 });
  for (const input of [null, [], new Date(), 1, 'text']) expect(await c.callTool(name, input)).toMatchObject({ error: { kind: 'invalid_arguments' } });
  const rejected = context.executeTool.bind(context);
  context.executeTool = async () => { throw new DOMException('private', 'SecurityError'); };
  expect(await c.callTool(name, {})).toMatchObject({ error: { kind: 'rejected', domException: 'SecurityError' } });
  context.executeTool = async () => 'bad-json'; expect(await c.callTool(name, {})).toMatchObject({ error: { kind: 'rejected', domException: 'SyntaxError' } });
  context.executeTool = rejected; lifetime.abort();
  expect(await c.callTool(name)).toMatchObject({ error: { kind: 'unavailable' } });
  await c.getTools(); expect(await c.callTool(name)).toMatchObject({ error: { kind: 'unavailable' } });
  await registerTool(implementTool(defineTool({ name: 'call', description: 'c' }), () => { throw new ToolError('Fix it', { code: 'FIX' }); }), { modelContext: context });
  expect((await c.getTools())[0]!.name).toBe(name);
  expect(await c.callTool(name)).toMatchObject({ error: { kind: 'tool_failed', message: 'Fix it', failure: { code: 'FIX' } } });
  c.dispose(); expect(c.isCatalogTool(name)).toBe(true); expect(await c.callTool(name)).toMatchObject({ error: { kind: 'unavailable' } });
});
it('dispose invalidates in-flight discovery and releases listeners', async () => {
  const context = new FakeModelContext(); const gate = deferred<readonly RegisteredTool[]>(); context.getTools = () => gate.promise;
  const c = catalog({ modelContext: context }); const listener = vi.fn(); c.subscribe(listener); await Promise.resolve(); listener.mockClear();
  c.dispose(); gate.resolve([descriptor('late')]); await tick(); expect(listener).not.toHaveBeenCalled(); expect(c.isCatalogTool('f1__late')).toBe(false);
});
