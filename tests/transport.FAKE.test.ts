/** FAKE transport checks, not browser conformance. */
import { expect, it, vi } from 'vitest';
import { FakeModelContext } from './FAKE-model-context.js';
import { deferred } from './helpers.js';
it('rejects result serialization failures as OperationError', async () => {
  const c = new FakeModelContext();
  await c.registerTool({ name: 'cycle', description: 'Cycle', execute: async () => { const value: any = {}; value.self = value; return value; } });
  await expect(c.executeTool((await c.getTools())[0]!)).rejects.toMatchObject({ name: 'OperationError' });
});
it('does not serialize a late result after cancellation', async () => {
  const c = new FakeModelContext(), gate = deferred<any>(), serialized = vi.fn(() => 1), owner = new AbortController();
  const finished = deferred<void>();
  await c.registerTool({ name: 'late', description: 'Late', execute: () => gate.promise });
  const result = c.executeTool((await c.getTools())[0]!, {}, { signal: owner.signal });
  owner.abort(); await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  // This observer is registered after the transport's result observer.
  void gate.promise.then(() => finished.resolve());
  gate.resolve({ toJSON: serialized }); await finished.promise; expect(serialized).not.toHaveBeenCalled();
});
it('clones input before invoking a handler', async () => {
  const c = new FakeModelContext(), input = { nested: { n: 1 } };
  await c.registerTool({ name: 'input', description: 'Input', execute: async (value: any) => { value.nested.n = 2; return null; } });
  await c.executeTool((await c.getTools())[0]!, input); expect(input.nested.n).toBe(1);
});
it('checks descriptor origin before execution', async () => {
  const c = new FakeModelContext(), handler = vi.fn(async () => 1);
  await c.registerTool({ name: 'origin', description: 'Origin', execute: handler });
  await expect(c.executeTool({ ...(await c.getTools())[0]!, origin: 'https://other.example' })).rejects.toMatchObject({ name: 'SecurityError' });
  expect(handler).not.toHaveBeenCalled();
});
