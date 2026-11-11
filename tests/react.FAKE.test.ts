// @vitest-environment happy-dom
/** React lifecycle tests against a FAKE, not native WebMCP. */
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineTool, implementTool, registerTool } from '../src/index.js';
import { RegisterTools, useRegisterTools, useToolCatalog } from '../src/react/index.js';
import type { RegisteredToolsState, UseRegisterToolsOptions, UseToolCatalogResult } from '../src/react/index.js';
import type { AnyToolImplementation } from '../src/index.js';
import { FakeModelContext, deferred } from './FAKE-model-context.js';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
const containers: HTMLElement[] = [];
function root() { const el = document.createElement('div'); document.body.append(el); containers.push(el); const r = createRoot(el); roots.push(r); return r; }
afterEach(async () => { await act(async () => { roots.splice(0).forEach(r => r.unmount()); }); containers.splice(0).forEach(c => c.remove()); vi.restoreAllMocks(); });
const a = defineTool({ name: 'a', description: 'A' });
const b = defineTool({ name: 'b', description: 'B' });
const impl = (value = 1) => implementTool(a, () => value);
let state: RegisteredToolsState;
function Publisher({ tools, options, probe }: { tools: readonly AnyToolImplementation[]; options?: UseRegisterToolsOptions; probe?: () => void }) {
  state = useRegisterTools(tools, options); probe?.(); return null;
}
const render = async (r: ReturnType<typeof root>, tools: readonly AnyToolImplementation[], options?: UseRegisterToolsOptions) => { await act(async () => { r.render(h(Publisher, { tools, options })); }); };
async function call(c: FakeModelContext, name = 'a') { return c.executeTool((await c.getTools()).find(t => t.name === name)!); }
it('mount registers, factory refresh keeps registration and only takes effect after commit, unmount aborts', async () => {
  const c = new FakeModelContext(), spy = vi.spyOn(c, 'registerTool'), r = root();
  await render(r, [impl(1)], { modelContext: c });
  expect(state).toMatchObject({ supported: true, tools: [{ state: 'registered' }] });
  let during!: Promise<string>;
  await act(async () => { r.render(h(Publisher, { tools: [impl(2)], options: { modelContext: c }, probe: () => { during = call(c); } })); });
  // Start directly in render; discovery itself is asynchronous.
  let before!: Promise<unknown>;
  await act(async () => { r.render(h(Publisher, { tools: [impl(3)], options: { modelContext: c }, probe: () => { before ??= c.tools.get('a')!.execute({}, { signal: new AbortController().signal }); } })); });
  expect(await before).toBe(2); expect(await during).toBe('2'); expect(await call(c)).toBe('3'); expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => r.unmount()); roots.splice(roots.indexOf(r), 1); expect(c.tools.size).toBe(0);
});
it('adds/removes definitions and orders same-name replacement after abort', async () => {
  const c = new FakeModelContext(), r = root(), events: string[] = [];
  const original = c.registerTool.bind(c);
  vi.spyOn(c, 'registerTool').mockImplementation((t, o) => { events.push(`register:${t.name}`); o?.signal?.addEventListener('abort', () => events.push(`abort:${t.name}`)); return original(t, o); });
  await render(r, [impl()], { modelContext: c });
  const second = implementTool(b, () => 2);
  await render(r, [impl(), second], { modelContext: c }); expect([...c.tools.keys()]).toEqual(['a', 'b']);
  await render(r, [impl()], { modelContext: c }); expect(c.tools.has('b')).toBe(false);
  const replacement = implementTool(defineTool({ name: 'a', description: 'New' }), () => 4);
  await render(r, [replacement], { modelContext: c });
  expect(events.slice(-2)).toEqual(['abort:a', 'register:a']); expect(await call(c)).toBe('4');
});
it('enabled removes tools; exposure compares origin sets by value; context changes replace', async () => {
  const c = new FakeModelContext(), d = new FakeModelContext(), r = root(), spy = vi.spyOn(c, 'registerTool');
  await render(r, [impl()], { modelContext: c, exposedTo: ['x', 'y'] });
  await render(r, [impl()], { modelContext: c, exposedTo: ['y', 'x', 'x'] }); expect(spy).toHaveBeenCalledTimes(1);
  await render(r, [impl()], { modelContext: c, exposedTo: ['z'] }); expect(spy).toHaveBeenCalledTimes(2);
  await render(r, [impl()], { modelContext: d }); expect(c.tools.size).toBe(0); expect(d.tools.size).toBe(1);
  await render(r, [impl()], { modelContext: d, enabled: false }); expect(d.tools.size).toBe(0); expect(state.tools).toEqual([]);
});
it('StrictMode replays registration without duplicate errors', async () => {
  const c = new FakeModelContext(), r = root(), spy = vi.spyOn(c, 'registerTool');
  await act(async () => { r.render(h(StrictMode, null, h(Publisher, { tools: [impl()], options: { modelContext: c } }))); });
  expect(spy).toHaveBeenCalledTimes(2); expect(state.tools[0]?.state).toBe('registered');
});
it('SDK duplicate retries after the other component unmounts', async () => {
  const c = new FakeModelContext(), first = root(), second = root();
  await render(first, [impl()], { modelContext: c }); await render(second, [impl(7)], { modelContext: c });
  expect(state.tools[0]).toMatchObject({ state: 'error', error: { code: 'duplicate_name' } });
  await act(async () => first.unmount()); roots.splice(roots.indexOf(first), 1);
  expect(state.tools[0]?.state).toBe('registered'); expect(await call(c)).toBe('7');
});
it('also retries a conflict with a core registration', async () => {
  const c = new FakeModelContext(), owner = new AbortController(), r = root();
  await registerTool(impl(), { modelContext: c, signal: owner.signal });
  await render(r, [impl(8)], { modelContext: c }); await act(async () => owner.abort()); expect(await call(c)).toBe('8');
});
it('foreign conflicts remain errors', async () => {
  const c = new FakeModelContext(), owner = new AbortController(), r = root();
  await c.registerTool({ name: 'a', description: 'Foreign', execute: async () => 1 }, { signal: owner.signal });
  await render(r, [impl()], { modelContext: c }); await act(async () => owner.abort()); expect(state.tools[0]?.state).toBe('error');
});
it('unsupported context can be installed on a later render', async () => {
  const r = root(); await render(r, [impl()]); expect(state).toMatchObject({ supported: false, tools: [{ state: 'unsupported' }] });
  const c = new FakeModelContext(); Object.defineProperty(document, 'modelContext', { configurable: true, value: c });
  try { await render(r, [impl()]); expect(state.supported).toBe(true); expect(c.tools.size).toBe(1); } finally { delete (document as any).modelContext; }
});
it('running calls retain their handler and native signal through refresh and unmount', async () => {
  const c = new FakeModelContext(), r = root(), started = deferred<AbortSignal>(), finish = deferred<number>();
  await render(r, [implementTool(a, (_, { signal }) => { started.resolve(signal); return finish.promise; })], { modelContext: c });
  const result = call(c), signal = await started.promise;
  await render(r, [impl(9)], { modelContext: c }); await act(async () => r.unmount()); roots.splice(roots.indexOf(r), 1);
  expect(signal.aborted).toBe(false); finish.resolve(42); expect(await result).toBe('42');
});
it('unexpected errors use the latest callback without re-registering', async () => {
  const c = new FakeModelContext(), r = root(), first = vi.fn(), second = vi.fn();
  const broken = implementTool(a, () => { throw Error('oops'); });
  await render(r, [broken], { modelContext: c, onUnexpectedError: first });
  await render(r, [broken], { modelContext: c, onUnexpectedError: second }); await call(c);
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
});
it('RegisterTools renders children as-is and owns its lifetime', async () => {
  const c = new FakeModelContext(), r = root();
  await act(async () => r.render(h(RegisterTools, { tools: [impl()], modelContext: c }, 'child')));
  expect(containers.at(-1)!.textContent).toBe('child'); expect(c.tools.has('a')).toBe(true);
});
it('catalog reacts to toolchange, compares origins by value, survives StrictMode and never disposes', async () => {
  const c = new FakeModelContext(), r = root(), query = vi.spyOn(c, 'getTools'); let result!: UseToolCatalogResult;
  function Consumer({ origins }: { origins: string[] }) { result = useToolCatalog({ modelContext: c, fromOrigins: origins }); return null; }
  await act(async () => r.render(h(StrictMode, null, h(Consumer, { origins: ['x', 'y'] }))));
  expect(result.status).toBe('ready'); const catalog = result.catalog, dispose = vi.spyOn(catalog, 'dispose'), count = query.mock.calls.length;
  await act(async () => r.render(h(StrictMode, null, h(Consumer, { origins: ['y', 'x'] })))); expect(query).toHaveBeenCalledTimes(count);
  await act(async () => r.render(h(StrictMode, null, h(Consumer, { origins: ['z'] })))); expect(query).toHaveBeenCalledTimes(count + 1);
  const owner = new AbortController(); await act(async () => { await registerTool(impl(), { modelContext: c, signal: owner.signal }); }); expect(result.tools).toHaveLength(1);
  await act(async () => owner.abort()); expect(result.tools).toHaveLength(0);
  await act(async () => r.unmount()); roots.splice(roots.indexOf(r), 1); expect(dispose).not.toHaveBeenCalled(); expect(result.catalog).toBe(catalog);
  const calls = query.mock.calls.length; c.dispatchEvent(new Event('toolchange')); await Promise.resolve(); expect(query).toHaveBeenCalledTimes(calls);
});

it('warns for repeated definition identity churn only in development', async () => {
  const c = new FakeModelContext(), r = root(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const next = () => implementTool(defineTool({ name: 'inline', description: 'Inline' }), () => 1);
  for (let i = 0; i < 4; i++) await render(r, [next()], { modelContext: c });
  expect(warn).toHaveBeenCalledOnce(); expect(warn.mock.calls[0]?.[0]).toContain('module scope');
  vi.stubEnv('NODE_ENV', 'production');
  try {
    const second = root();
    for (let i = 0; i < 4; i++) await render(second, [next()], { modelContext: new FakeModelContext() });
    expect(warn).toHaveBeenCalledOnce();
  } finally { vi.unstubAllEnvs(); }
});
it('reports pending registration and ignores its settlement after unmount', async () => {
  const c = new FakeModelContext(), r = root(), gate = deferred<void>();
  const original = c.registerTool.bind(c);
  vi.spyOn(c, 'registerTool').mockImplementation(async (t, o) => { await gate.promise; await original(t, o); });
  await render(r, [impl()], { modelContext: c }); expect(state.tools[0]?.state).toBe('pending');
  await act(async () => r.unmount()); roots.splice(roots.indexOf(r), 1);
  await act(async () => gate.resolve()); expect(c.tools.size).toBe(0);
});
it('calls capture the handler before asynchronous input validation', async () => {
  const c = new FakeModelContext(), r = root(), gate = deferred<void>();
  const { z } = await import('zod');
  const definition = defineTool({ name: 'validated', description: 'Async validation', input: z.object({}).refine(async () => { await gate.promise; return true; }) });
  await render(r, [implementTool(definition, () => 1)], { modelContext: c });
  const descriptor = (await c.getTools())[0]!;
  const pending = c.executeTool(descriptor);
  await render(r, [implementTool(definition, () => 2)], { modelContext: c });
  gate.resolve(); expect(await pending).toBe('1'); expect(await c.executeTool(descriptor)).toBe('2');
});

it('list reordering preserves registrations and reports tools in the current order', async () => {
  const c = new FakeModelContext(), r = root(), spy = vi.spyOn(c, 'registerTool');
  const second = implementTool(b, () => 2);
  await render(r, [impl(), second], { modelContext: c });
  await render(r, [second, impl()], { modelContext: c });
  expect(state.tools.map(t => t.name)).toEqual(['b', 'a']); expect(spy).toHaveBeenCalledTimes(2);
});
