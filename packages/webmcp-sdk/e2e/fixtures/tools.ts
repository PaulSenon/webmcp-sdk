import { z } from 'zod';
import { defineTool, implementTool } from '@senon/webmcp-sdk';
// Module-scope definitions are shared by plain TS and React publishers.
export const increment = defineTool({
  name: 'increment', description: 'Add one to n.',
  input: z.object({ n: z.number() }), output: z.number(),
});
export const incrementTool = implementTool(increment, ({ n }) => n + 1);
