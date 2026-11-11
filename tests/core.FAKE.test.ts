import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, implementTool, runTool, toJSONSchema, withJsonSchema, ToolError, isToolError,
  isToolFailureEnvelope, registerTool, registerTools } from '../src/index.js';
import { FakeModelContext, deferred } from './FAKE-model-context.js';
const definition = () => defineTool({ name: 'test', description: 'Test' });
const tool = () => implementTool(definition(), () => 1);
describe('definitions and schemas', () => {
  it.each(['', 'a b', 'x'.repeat(129), 'é'])('rejects invalid name %s', name => {
    expect(() => defineTool({ name, description: 'ok' })).toThrow(expect.objectContaining({ code: 'invalid_definition' }));
  });
  it('checks description and freezes plain values', () => {
    expect(() => defineTool({ name: 'ok', description: ' ' })).toThrow();
    expect(Object.isFrozen(definition())).toBe(true); expect(Object.isFrozen(tool())).toBe(true);
  });
  it('converts eagerly, caches per definition, requests the right side/dialect', () => {
    const input = vi.fn(() => ({ type: 'object' })); const output = vi.fn(() => ({ type: 'string' }));
    const schema = { '~standard': { version: 1 as const, vendor: 'fake', validate: (x: object) => ({ value: x }), jsonSchema: { input, output } } };
    const d = defineTool({ name: 'schema', description: 'schema', input: schema, output: schema });
    expect(toJSONSchema(d).output).toEqual({ ok: true, schema: { type: 'string' } });
    toJSONSchema(d); expect(input).toHaveBeenCalledExactlyOnceWith({ target: 'draft-2020-12' }); expect(output).toHaveBeenCalledTimes(1);
    expect(toJSONSchema(definition()).input).toEqual({ ok: true, schema: { type: 'object', properties: {} } });
  });
  it('reports unrepresentable dates and non-object roots', () => {
    expect(toJSONSchema(defineTool({ name: 'date', description: 'd', input: z.object({ date: z.date() }) })).input.ok).toBe(false);
    const schema = withJsonSchema(z.object({}), { input: { type: 'array' } });
    expect(toJSONSchema(defineTool({ name: 'root', description: 'r', input: schema })).input.ok).toBe(false);
  });
  it('wrapper preserves validator and never validates using JSON Schema', async () => {
    const original = z.object({ x: z.string() }); const wrapped = withJsonSchema(original, { input: { type: 'object' } });
    expect(wrapped['~standard'].validate).toBe(original['~standard'].validate);
    expect((await runTool(implementTool(defineTool({ name: 'wrapped', description: 'w', input: wrapped }), () => null), { x: 2 })).ok).toBe(false);
  });
});
describe('execution', () => {
  it('normalizes undefined and void', async () => {
    const handler = vi.fn(() => {}); expect(await runTool(implementTool(definition(), handler), undefined)).toEqual({ ok: true, value: null });
    expect(handler.mock.calls[0]?.[0]).toEqual({});
  });
  it('awaits async refinements and transforms both sides', async () => {
    const d = defineTool({ name: 'transform', description: 't', input: z.object({ x: z.string().transform(Number) }).refine(async x => x.x > 0),
      output: z.date().transform(d => d.toISOString()) });
    const t = implementTool(d, ({ x }) => new Date(x));
    expect(await runTool(t, { x: '1' })).toEqual({ ok: true, value: new Date(1).toISOString() });
    expect(await runTool(t, { x: '-1' })).toMatchObject({ ok: false, failure: { kind: 'input_invalid', handlerCalled: false } });
  });
  it('formats issue paths, root, cap without echoing input', async () => {
    const t = implementTool(defineTool({ name: 'issues', description: 'i', input: z.object({ items: z.array(z.object({ sku: z.string() })) }) }), () => null);
    const r = await runTool(t, { items: Array.from({ length: 23 }, () => ({ sku: 123456789 })) });
    expect(r).toMatchObject({ failure: { issues: expect.arrayContaining([{ path: 'items[0].sku', message: expect.any(String) }]), omittedIssues: 3 } });
    if (!r.ok && r.failure.kind === 'input_invalid') expect(r.failure.issues).toHaveLength(20);
    expect(JSON.stringify(r)).not.toContain('123456789');
    expect(await runTool(t, null)).toMatchObject({ failure: { issues: [{ path: '(root)', message: expect.any(String) }] } });
  });
  it('recognizes cross-copy brand and whitelists fields', async () => {
    class Business extends ToolError { secret = 'private'; }
    const error = new Business('Try another', { code: 'NO', data: { left: 1 }, cause: new Error('private') });
    expect(isToolError(error)).toBe(true); expect(isToolError({ [Symbol.for('webmcp-sdk.tool-error')]: true })).toBe(true);
    expect(await runTool(implementTool(definition(), () => { throw error; }), {})).toEqual({ ok: false,
      failure: { kind: 'tool_error', handlerCalled: true, message: 'Try another', code: 'NO', data: { left: 1 } } });
  });
  it.each(['internal', 'output_invalid', 'dropped data'] as const)('reports %s while protecting private details', async kind => {
    const context = new FakeModelContext(); const hook = vi.fn();
    const cycle: any = {}; cycle.self = cycle;
    const t = kind === 'output_invalid' ? implementTool(defineTool({ name: 'test', description: 't', output: z.string() }), () => 42 as any)
      : implementTool(definition(), () => { if (kind === 'internal') throw new Error('private'); throw new ToolError('public', { data: cycle }); });
    await registerTool(t, { modelContext: context, onUnexpectedError: hook });
    const value = await context.executeTool((await context.getTools())[0]!);
    expect(hook).toHaveBeenCalledTimes(1); expect(value).not.toContain('private'); expect(value).not.toContain('self');
  });
  it('handles crashing validators, cycles, bigint, top-level function, and throwing hooks', async () => {
    const input = withJsonSchema({ '~standard': { version: 1 as const, vendor: 'fake', validate: () => { throw new Error('private'); } } }, { input: { type: 'object' } });
    expect(await runTool(implementTool(defineTool({ name: 'crash', description: 'c', input }), () => null), {})).toMatchObject({ failure: { kind: 'internal', handlerCalled: false } });
    const cycle: any = {}; cycle.x = cycle;
    for (const value of [cycle, 1n, () => {}]) expect(await runTool(implementTool(definition(), () => value as any), {})).toMatchObject({ failure: { kind: 'output_invalid' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const context = new FakeModelContext();
    await registerTool(implementTool(definition(), () => { throw new Error(); }), { modelContext: context, onUnexpectedError: () => { throw new Error('hook'); } });
    await context.executeTool((await context.getTools())[0]!); expect(log).toHaveBeenCalled(); log.mockRestore();
  });
  it('checks envelopes by the documented minimal fields', () => {
    expect(isToolFailureEnvelope({ isError: true, error: { kind: 'internal', message: 'm' } })).toBe(true);
    for (const v of [null, {}, { isError: true, error: { kind: 'other', message: 'm' } }, { isError: true, error: { kind: 'internal', message: 1 } }]) expect(isToolFailureEnvelope(v)).toBe(false);
  });
});
describe('registration with FAKE', () => {
  it('unsupported and already aborted', async () => {
    expect(await registerTool(tool())).toBe('unsupported');
    const c = new AbortController(); c.abort('reason');
    await expect(registerTool(tool(), { signal: c.signal })).rejects.toBe('reason');
    await expect(registerTools([], { signal: c.signal })).rejects.toBe('reason');
  });
  it('advertises envelope anyOf and passes native options', async () => {
    const context = new FakeModelContext(); const spy = vi.spyOn(context, 'registerTool');
    const c = new AbortController();
    await registerTool(implementTool(defineTool({ name: 'out', description: 'o', title: 'O', output: z.number(), annotations: { readOnlyHint: true } }), () => 1), { modelContext: context, signal: c.signal, exposedTo: ['https://example.com'] });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ title: 'O', annotations: { readOnlyHint: true }, outputSchema: { anyOf: [{ type: 'number' }, expect.any(Object)] } });
    expect(spy.mock.calls[0]?.[1]).toEqual({ signal: c.signal, exposedTo: ['https://example.com'] });
  });
  it('partial failures, duplicate names, converter failure, native causes', async () => {
    const context = new FakeModelContext(); const t = tool();
    const results = await registerTools([t, t] as any, { modelContext: context });
    expect(results.map(r => r.status)).toEqual(['registered', 'error']); expect(results[1]).toMatchObject({ error: { code: 'duplicate_name' } });
    await expect(registerTool(t, { modelContext: context })).rejects.toMatchObject({ code: 'duplicate_name' });
    await expect(registerTool(implementTool(defineTool({ name: 'date', description: 'd', input: z.object({ d: z.date() }) }), () => null), { modelContext: context })).rejects.toMatchObject({ code: 'json_schema_unavailable' });
    const cause = new DOMException('Denied', 'NotAllowedError');
    await expect(registerTool(t, { modelContext: { registerTool: async () => { throw cause; } } })).rejects.toMatchObject({ code: 'registration_failed', cause });
  });
  it('preserves abort reason while pending and orders replacement after native settlement', async () => {
    const gate = deferred<void>(); const context = new FakeModelContext(); let count = 0;
    const native = context.registerTool.bind(context);
    context.registerTool = async (...args) => { count++; if (count === 1) await gate.promise; return native(...args); };
    const c = new AbortController(); const first = registerTool(tool(), { modelContext: context, signal: c.signal });
    c.abort('stop'); await expect(first).rejects.toBe('stop');
    const second = registerTool(tool(), { modelContext: context });
    await Promise.resolve(); expect(count).toBe(1); gate.resolve(); expect(await second).toBe('registered');
  });
  it('batch abort rejects without rollback', async () => {
    const gate = deferred<void>(); const c = new AbortController();
    const p = registerTools([tool()], { modelContext: { registerTool: () => gate.promise }, signal: c.signal });
    c.abort('batch'); await expect(p).rejects.toBe('batch'); gate.resolve();
  });
  it('D16: unregister during execution preserves signal and delivers late result', async () => {
    const context = new FakeModelContext(); const lifetime = new AbortController(); const started = deferred<void>(); const finish = deferred<number>(); let signal!: AbortSignal;
    await registerTool(implementTool(definition(), async (_, call) => { signal = call.signal; started.resolve(); return finish.promise; }), { modelContext: context, signal: lifetime.signal });
    const call = context.executeTool((await context.getTools())[0]!); await started.promise;
    lifetime.abort(); expect(context.tools.size).toBe(0); expect(signal.aborted).toBe(false);
    finish.resolve(7); expect(await call).toBe('7');
  });
  it('caller cancellation rejects with reason and aborts execution signal', async () => {
    const context = new FakeModelContext(); let signal!: AbortSignal; const finish = deferred<number>();
    await registerTool(implementTool(definition(), (_, call) => { signal = call.signal; return finish.promise; }), { modelContext: context });
    const c = new AbortController(); const call = context.executeTool((await context.getTools())[0]!, {}, { signal: c.signal });
    c.abort('caller'); await expect(call).rejects.toBe('caller'); expect(signal.aborted).toBe(true); finish.resolve(1);
  });
});
it('output validator throws are output_invalid; successful output and business errors do not notify', async () => {
  const context = new FakeModelContext(); const hook = vi.fn();
  const output = withJsonSchema({ '~standard': { version: 1 as const, vendor: 'fake', validate: () => { throw new Error('private'); } } }, { input: { type: 'string' } });
  await registerTool(implementTool(defineTool({ name: 'out_crash', description: 'c', output }), () => 'a'), { modelContext: context, onUnexpectedError: hook });
  expect(JSON.parse(await context.executeTool((await context.getTools())[0]!))).toMatchObject({ error: { kind: 'output_invalid', handlerCalled: true } });
  expect(hook).toHaveBeenCalledTimes(1); hook.mockClear();
  await registerTool(implementTool(defineTool({ name: 'business', description: 'b' }), () => { throw new ToolError('public'); }), { modelContext: context, onUnexpectedError: hook });
  await context.executeTool((await context.getTools()).find(t => t.name === 'business')!); expect(hook).not.toHaveBeenCalled();
  expect(context.tools.get('business')?.outputSchema).toBeUndefined();
});
it('duplicate attempt does not hide an older pending registration from aborted replacement', async () => {
  const context = new FakeModelContext(); const gate = deferred<void>(); let n = 0;
  const native = context.registerTool.bind(context);
  context.registerTool = async (...args) => { if (++n === 1) { await native(...args); await gate.promise; } else await native(...args); };
  const c = new AbortController(); const first = registerTool(tool(), { modelContext: context, signal: c.signal });
  await expect(registerTool(tool(), { modelContext: context })).rejects.toMatchObject({ code: 'duplicate_name' });
  c.abort('done'); await expect(first).rejects.toBe('done');
  const replacement = registerTool(tool(), { modelContext: context }); await Promise.resolve(); expect(n).toBe(2);
  gate.resolve(); expect(await replacement).toBe('registered');
});
