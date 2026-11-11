import { deferred } from './helpers.js';
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, implementTool, runTool, toJSONSchema, withJsonSchema, ToolError, isToolError,
  isToolFailureEnvelope, registerTool, registerTools } from '../src/index.js';
import { FakeModelContext } from './FAKE-model-context.js';
const definition = () => defineTool({ name: 'test', description: 'Test' });
const tool = () => implementTool(definition(), () => 1);
describe('definitions and schemas', () => {
  it.each(['', 'a b', 'x'.repeat(129), 'é'])('rejects invalid name %s', name => {
    expect(() => defineTool({ name, description: 'ok' })).toThrow(expect.objectContaining({ code: 'invalid_definition' }));
  });
  it('rejects an empty description', () => {
    expect(() => defineTool({ name: 'ok', description: ' ' })).toThrow();
  });
  it('freezes definitions and implementations', () => {
    expect(Object.isFrozen(definition())).toBe(true); expect(Object.isFrozen(tool())).toBe(true);
  });
  it('converts eagerly, caches per definition, requests the right side/dialect', () => {
    const input = vi.fn(() => ({ type: 'object' })); const output = vi.fn(() => ({ type: 'string' }));
    const schema = { '~standard': { version: 1 as const, vendor: 'fake', validate: (x: object) => ({ value: x }), jsonSchema: { input, output } } };
    const d = defineTool({ name: 'schema', description: 'schema', input: schema, output: schema });
    expect(toJSONSchema(d).output).toEqual({ ok: true, schema: { type: 'string' } });
    toJSONSchema(d); expect(input).toHaveBeenCalledExactlyOnceWith({ target: 'draft-2020-12' }); expect(output).toHaveBeenCalledTimes(1);
  });
  it('supplies an empty-object schema for omitted input', () => {
    expect(toJSONSchema(definition()).input).toEqual({ ok: true, schema: { type: 'object', properties: {} } });
  });
  it('reports an unrepresentable input date', () => {
    expect(toJSONSchema(defineTool({ name: 'date', description: 'd', input: z.object({ date: z.date() }) })).input.ok).toBe(false);
  });
  it('rejects an input schema with a non-object root', () => {
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
  it('maps crashing input validators to internal failure before calling the handler', async () => {
    const input = withJsonSchema({ '~standard': { version: 1 as const, vendor: 'test', validate: () => { throw Error('private'); } } }, { input: { type: 'object' } });
    expect(await runTool(implementTool(defineTool({ name: 'crash', description: 'Crash', input }), () => null), {})).toMatchObject({ failure: { kind: 'internal', handlerCalled: false } });
  });
  it.each(['cycle', 'bigint', 'function'])('maps unserializable %s output to output_invalid', async kind => {
    const cycle: any = {}; cycle.x = cycle;
    const value = kind === 'cycle' ? cycle : kind === 'bigint' ? 1n : () => {};
    expect(await runTool(implementTool(definition(), () => value as any), {})).toMatchObject({ failure: { kind: 'output_invalid' } });
  });
  it('contains synchronous hook exceptions', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {}), context = new FakeModelContext();
    try {
      await registerTool(implementTool(definition(), () => { throw Error('handler'); }), { modelContext: context, onUnexpectedError: () => { throw Error('hook'); } });
      await context.executeTool((await context.getTools())[0]!); expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it('checks envelopes by the documented minimal fields', () => {
    expect(isToolFailureEnvelope({ isError: true, error: { kind: 'internal', message: 'm' } })).toBe(true);
    for (const v of [null, {}, { isError: true, error: { kind: 'other', message: 'm' } }, { isError: true, error: { kind: 'internal', message: 1 } }]) expect(isToolFailureEnvelope(v)).toBe(false);
  });
});
describe('registration', () => {
  it('reports unsupported without a default context', async () => {
    expect(await registerTool(tool())).toBe('unsupported');
  });
  it('preserves an already-aborted registration reason', async () => {
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
  it('keeps successful batch registrations when a later name is duplicated', async () => {
    const context = new FakeModelContext(), t = tool();
    const results = await registerTools([t, t] as any, { modelContext: context });
    expect(results.map(r => r.status)).toEqual(['registered', 'error']); expect(results[1]).toMatchObject({ error: { code: 'duplicate_name' } });
  });
  it('maps a native name conflict to duplicate_name', async () => {
    const context = new FakeModelContext(), t = tool(); await registerTool(t, { modelContext: context });
    await expect(registerTool(t, { modelContext: context })).rejects.toMatchObject({ code: 'duplicate_name' });
  });
  it('rejects registration when input schema conversion fails', async () => {
    await expect(registerTool(implementTool(defineTool({ name: 'date', description: 'Date', input: z.object({ d: z.date() }) }), () => null), { modelContext: new FakeModelContext() })).rejects.toMatchObject({ code: 'json_schema_unavailable' });
  });
  it('preserves the cause of native registration failure', async () => {
    const cause = new DOMException('Denied', 'NotAllowedError');
    await expect(registerTool(tool(), { modelContext: { registerTool: async () => { throw cause; } } })).rejects.toMatchObject({ code: 'registration_failed', cause });
  });
  it('preserves abort reason while pending and orders replacement after native settlement', async () => {
    const gate = deferred<void>(); const context = new FakeModelContext(); let count = 0;
    const native = context.registerTool.bind(context);
    context.registerTool = async (...args) => { count++; if (count === 1) await gate.promise; return native(...args); };
    const c = new AbortController(); const first = registerTool(tool(), { modelContext: context, signal: c.signal });
    c.abort('stop'); await expect(first).rejects.toBe('stop');
    const second = registerTool(tool(), { modelContext: context });
    expect(count).toBe(1); gate.resolve(); expect(await second).toBe('registered');
  });
  it('batch abort rejects without rollback', async () => {
    const gate = deferred<void>(); const c = new AbortController();
    const p = registerTools([tool()], { modelContext: { registerTool: () => gate.promise }, signal: c.signal });
    c.abort('batch'); await expect(p).rejects.toBe('batch'); gate.resolve();
  });
  it('caller cancellation rejects with reason and aborts execution signal', async () => {
    const context = new FakeModelContext(); let signal!: AbortSignal; const finish = deferred<number>();
    await registerTool(implementTool(definition(), (_, call) => { signal = call.signal; return finish.promise; }), { modelContext: context });
    const c = new AbortController(); const call = context.executeTool((await context.getTools())[0]!, {}, { signal: c.signal });
    c.abort('caller'); await expect(call).rejects.toBe('caller'); expect(signal.aborted).toBe(true); finish.resolve(1);
  });
});
it('maps a crashing output validator to output_invalid', async () => {
  const context = new FakeModelContext(), hook = vi.fn();
  const output = withJsonSchema({ '~standard': { version: 1 as const, vendor: 'test', validate: () => { throw Error('private'); } } }, { input: { type: 'string' } });
  await registerTool(implementTool(defineTool({ name: 'out_crash', description: 'Crash', output }), () => 'a'), { modelContext: context, onUnexpectedError: hook });
  expect(JSON.parse(await context.executeTool((await context.getTools())[0]!))).toMatchObject({ error: { kind: 'output_invalid', handlerCalled: true } }); expect(hook).toHaveBeenCalledOnce();
});
it('does not notify for a business error without data', async () => {
  const context = new FakeModelContext(), hook = vi.fn();
  await registerTool(implementTool(definition(), () => { throw new ToolError('public'); }), { modelContext: context, onUnexpectedError: hook });
  await context.executeTool((await context.getTools())[0]!); expect(hook).not.toHaveBeenCalled();
  expect(context.tools.get('test')?.outputSchema).toBeUndefined();
});
it('duplicate attempt does not hide an older pending registration from aborted replacement', async () => {
  const context = new FakeModelContext(); const gate = deferred<void>(); let n = 0;
  const native = context.registerTool.bind(context);
  context.registerTool = async (...args) => { if (++n === 1) { await native(...args); await gate.promise; } else await native(...args); };
  const c = new AbortController(); const first = registerTool(tool(), { modelContext: context, signal: c.signal });
  await expect(registerTool(tool(), { modelContext: context })).rejects.toMatchObject({ code: 'duplicate_name' });
  c.abort('done'); await expect(first).rejects.toBe('done');
  const replacement = registerTool(tool(), { modelContext: context }); expect(n).toBe(2);
  gate.resolve(); expect(await replacement).toBe('registered');
});

it('promotes a successful owner after an unconvertible attempt fails', async () => {
  const c = new FakeModelContext(), a = new AbortController(), b = new AbortController();
  const input = withJsonSchema(z.object({}), { input: () => { throw Error('conversion'); } } as any);
  const bad = implementTool(defineTool({ name: 'test', description: 'Bad', input }), () => 0);
  const failed = registerTool(bad, { modelContext: c, signal: a.signal });
  const good = registerTool(tool(), { modelContext: c, signal: b.signal });
  await expect(failed).rejects.toMatchObject({ code: 'json_schema_unavailable' });
  expect(await good).toBe('registered'); a.abort();
  const { registrationConflictEnded } = await import('../src/register.js');
  const conflict = await registerTool(tool(), { modelContext: c }).catch(e => e);
  const notify = vi.fn(); registrationConflictEnded(conflict)!.subscribe(notify, new AbortController().signal);
  b.abort(); await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
});
it('serializes ToolError data with the envelope data key', async () => {
  const c = new FakeModelContext();
  const data = { toJSON(key: string) { return key; } } as any;
  await registerTool(implementTool(definition(), () => { throw new ToolError('business', { data }); }), { modelContext: c });
  expect(JSON.parse(await c.executeTool((await c.getTools())[0]!)).error.data).toBe('data');
});
it('returns a captured snapshot without invoking toJSON twice', async () => {
  const c = new FakeModelContext(); let calls = 0;
  await registerTool(implementTool(definition(), () => ({ toJSON() { if (++calls > 1) throw Error('twice'); return 7; } }) as any), { modelContext: c });
  expect(await c.executeTool((await c.getTools())[0]!)).toBe('7'); expect(calls).toBe(1);
});
it('drops ToolError data that fails in its envelope context', async () => {
  const c = new FakeModelContext(), hook = vi.fn();
  await registerTool(implementTool(definition(), () => { throw new ToolError('business', { data: { toJSON(key: string) { if (key === 'data') throw Error('data'); return 1; } } as any }); }), { modelContext: c, onUnexpectedError: hook });
  expect(JSON.parse(await c.executeTool((await c.getTools())[0]!))).toEqual({ isError: true, error: { kind: 'tool_error', handlerCalled: true, message: 'business' } });
  expect(hook).toHaveBeenCalledOnce();
});
it('observes rejection from an asynchronous unexpected-error hook', async () => {
  const logged = deferred<void>(), cause = Error('hook');
  const log = vi.spyOn(console, 'error').mockImplementation(() => logged.resolve());
  try {
    const c = new FakeModelContext();
    await registerTool(implementTool(definition(), () => { throw Error('handler'); }), { modelContext: c, onUnexpectedError: async () => { throw cause; } });
    await c.executeTool((await c.getTools())[0]!); await logged.promise;
    expect(log).toHaveBeenCalledWith('webmcp-sdk onUnexpectedError threw', cause);
  } finally { log.mockRestore(); }
});
it('reports output validation issues as an Error cause', async () => {
  const c = new FakeModelContext(), hook = vi.fn();
  await registerTool(implementTool(defineTool({ name: 'test', description: 'Test', output: z.number() }), () => 'bad' as any), { modelContext: c, onUnexpectedError: hook });
  await c.executeTool((await c.getTools())[0]!);
  expect(hook.mock.calls[0]![0]).toMatchObject({ message: 'Output validation failed', cause: expect.any(Array) });
});
it('does not notify the hook for successful output', async () => {
  const c = new FakeModelContext(), hook = vi.fn();
  await registerTool(tool(), { modelContext: c, onUnexpectedError: hook });
  await c.executeTool((await c.getTools())[0]!); expect(hook).not.toHaveBeenCalled();
});
it.each([
  ['input_invalid', 'Arguments rejected; the tool did not run. Fix the fields below and call again.'],
  ['output_invalid', 'The tool ran, but its result failed validation. The action may have been performed; check the current state before retrying.'],
  ['internal', 'The tool failed unexpectedly. It may have partially run; check the current state before retrying.'],
  ['tool_error', 'Business message'],
])('uses the documented message for %s', async (kind, message) => {
  const d = defineTool({ name: 'message', description: 'Message', ...(kind === 'input_invalid' ? { input: z.object({ n: z.number() }) } : {}), ...(kind === 'output_invalid' ? { output: z.number() } : {}) });
  const t = implementTool(d, (() => { if (kind === 'internal') throw Error('private'); if (kind === 'tool_error') throw new ToolError(message); return 'bad'; }) as any);
  expect(await runTool(t, {})).toMatchObject({ ok: false, failure: { kind, message } });
});
it('reuses a cached schema conversion failure', () => {
  const convert = vi.fn(() => { throw Error('conversion'); });
  const input = { '~standard': { version: 1 as const, vendor: 'test', validate: (x: object) => ({ value: x }), jsonSchema: { input: convert, output: convert } } };
  const d = defineTool({ name: 'cache_failure', description: 'Cache failure', input });
  const first = toJSONSchema(d);
  expect(first.input.ok).toBe(false); expect(toJSONSchema(d)).toBe(first); expect(convert).toHaveBeenCalledOnce();
});
it('snapshots business error data before native serialization', async () => {
  const c = new FakeModelContext(); let calls = 0;
  await registerTool(implementTool(definition(), () => { throw new ToolError('business', { data: { toJSON() { if (++calls > 1) throw Error('twice'); return { n: 1 }; } } as any }); }), { modelContext: c });
  expect(JSON.parse(await c.executeTool((await c.getTools())[0]!)).error.data).toEqual({ n: 1 }); expect(calls).toBe(1);
});
it('uses the documented message before a crashing validator runs a handler', async () => {
  const input = withJsonSchema({ '~standard': { version: 1 as const, vendor: 'test', validate() { throw Error('validator'); } } }, { input: { type: 'object' } });
  const t = implementTool(defineTool({ name: 'crash_message', description: 'Crash', input }), () => 1);
  expect(await runTool(t, {})).toMatchObject({ failure: { message: 'The tool failed unexpectedly before running. The tool did not run.' } });
});
it('unsubscribes a duplicate waiter when its controller aborts', async () => {
  const c = new FakeModelContext(), owner = new AbortController(), waiter = new AbortController();
  await registerTool(tool(), { modelContext: c, signal: owner.signal });
  const conflict = await registerTool(tool(), { modelContext: c }).catch(e => e);
  const { registrationConflictEnded } = await import('../src/register.js');
  const continuation = vi.fn(); registrationConflictEnded(conflict)!.subscribe(continuation, waiter.signal);
  waiter.abort(); owner.abort();
  await registerTool(tool(), { modelContext: c }); expect(continuation).not.toHaveBeenCalled();
});
