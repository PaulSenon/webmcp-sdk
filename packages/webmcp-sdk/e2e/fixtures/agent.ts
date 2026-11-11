import { platform } from './platform';
import { generateText, jsonSchema, tool } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createToolCatalog, registerTool } from 'webmcp-sdk';
import { incrementTool } from './tools';

if (platform.available) {
  await registerTool(incrementTool);
  const catalog = createToolCatalog();
  // The model lives behind a function. Tests may bridge that function to a Node
  // provider without ever sending an API key to the browser.
  async function loop(model: LanguageModel) {
    const tools = await catalog.getTools();
    const advertised = Object.fromEntries(tools.map(t => [t.name, tool({
      description: t.description, inputSchema: jsonSchema<Record<string, unknown>>(t.inputSchema),
    })]));
    const messages: ModelMessage[] = [{ role: 'user', content: 'Use increment with n=2, then report the result.' }];
    const first = await generateText({ model, tools: advertised, messages, toolChoice: 'required', maxRetries: 0 });
    messages.push(...first.response.messages);
    const routed = [];
    for (const call of first.toolCalls) {
      if (!catalog.isCatalogTool(call.toolName)) throw new Error('Not a catalog tool');
      const result = await catalog.callTool(call.toolName, call.input);
      routed.push(result);
      messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId,
        toolName: call.toolName, output: { type: 'json', value: JSON.parse(JSON.stringify(result)) } }] });
    }
    const final = await generateText({ model, messages, maxRetries: 0 });
    return { routed, text: final.text };
  }
  async function deterministic() {
    const name = (await catalog.getTools()).find(t => t.webmcpName === 'increment')!.name;
    const model = new MockLanguageModelV4({ doGenerate: async ({ prompt }) => {
      const feedback = prompt.find(message => message.role === 'tool');
      return {
        content: feedback ? [{ type: 'text', text: JSON.stringify(feedback.content) }] :
          [{ type: 'tool-call', toolCallId: 'call-1', toolName: name, input: '{"n":2}' }],
        finishReason: { unified: feedback ? 'stop' : 'tool-calls', raw: undefined },
        usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
        warnings: [],
      };
    } });
    const result = await loop(model);
    return { ...result, modelCalls: model.doGenerateCalls.length };
  }
  Object.assign(window, { fixture: { catalog, loop, deterministic, real: () => loop(new MockLanguageModelV4({
    doGenerate: options => (window as any).providerGenerate(options),
  })) } });
}
