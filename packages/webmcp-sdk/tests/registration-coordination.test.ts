import { it, expect, vi } from 'vitest';
import { coordinateRegistration, registrationConflictEnded } from '../src/registration-coordination.js';
it('removes an aborted waiter from the owner lifetime', async () => {
  const context = { registerTool: async () => {} }, owner = new AbortController(), waiter = new AbortController();
  await coordinateRegistration(context, 'a', owner.signal, async () => {});
  const error = { code: 'duplicate_name' };
  await expect(coordinateRegistration(context, 'a', undefined, async () => { throw error; })).rejects.toBe(error);
  const continuation = vi.fn();
  registrationConflictEnded(error)!.subscribe(continuation, waiter.signal);
  waiter.abort(); owner.abort();
  await coordinateRegistration(context, 'a', undefined, async () => {});
  expect(continuation).not.toHaveBeenCalled();
});
