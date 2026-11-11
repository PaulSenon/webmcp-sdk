import { platform } from './platform';
import { z } from 'zod';
import { createToolCatalog, defineTool, implementTool, registerTool, registerTools } from 'webmcp-sdk';
import { incrementTool } from './tools';
if (platform.available) {
  const lifetime = new AbortController();
  // Deliberately broken handler demonstrates publisher-side output validation.
  const invalidOutput = implementTool(defineTool({ name: 'invalid_output', description: 'Demonstrate rejected output.', output: z.number() }), () => 'wrong' as unknown as number);
  const batch = await registerTools([incrementTool, invalidOutput], { signal: lifetime.signal });
  if (batch.some(result => result.status !== 'registered')) throw new Error('Batch registration failed');
  // A deliberate gate makes unregister-during-execution deterministic, without timers.
  let finish!: (value: number) => void;
  let started = false;
  let executionSignal: AbortSignal | undefined;
  const wait = defineTool({ name: 'wait', description: 'Wait for explicit release.' });
  await registerTool(implementTool(wait, (_, { signal }) => {
    started = true; executionSignal = signal;
    return new Promise<number>(resolve => { finish = resolve; });
  }), { signal: lifetime.signal });
  const catalog = createToolCatalog();
  Object.assign(window, { fixture: {
    catalog, abort: () => lifetime.abort(), finish: () => finish(17),
    get started() { return started; }, get executionAborted() { return executionSignal?.aborted; },
  } });
}
