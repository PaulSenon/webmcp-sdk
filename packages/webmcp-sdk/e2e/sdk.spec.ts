import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { frameOrigin, parentOrigin } from '../playwright.config';

// Every test gets an isolated browser context. Deterministic runs cannot reach
// the internet, including from iframes; all imports are served by local Vite.
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return [parentOrigin, frameOrigin].includes(origin) ? route.continue() : route.abort();
  });
});
async function open(page: Page, name: string, info: TestInfo) {
  await page.goto(`/${name}.html?mode=${info.project.name}`);
  await page.waitForFunction(() => 'platform' in window);
  const native = await page.evaluate(() => (window as any).platform.native);
  test.skip(info.project.name === 'native' && !native,
    'Native document.modelContext is absent with --enable-features=WebMCP; no polyfill fallback');
  expect(native, 'Platform identity before any polyfill installation').toBe(info.project.name === 'native');
  await page.waitForFunction(() => 'fixture' in window);
}
async function tools(page: Page) {
  return page.evaluate(() => (window as any).fixture.catalog.getTools());
}
async function call(page: Page, name: string, input?: unknown) {
  return page.evaluate(({ name, input }) => (window as any).fixture.catalog.callTool(name, input), { name, input });
}
async function attachFrame(page: Page, origin: string, mode: string, expose: boolean) {
  const src = `${origin}/frame.html?${new URLSearchParams({ mode, expose: expose ? '1' : '0', parent: parentOrigin })}`;
  await page.evaluate(src => {
    const frame = document.createElement('iframe'); frame.src = src;
    frame.allow = 'tools'; document.body.append(frame);
  }, src);
  await expect.poll(() => page.frames().find(frame => frame.url() === src)?.url()).toBe(src);
  const frame = page.frames().find(frame => frame.url() === src)!;
  await frame.waitForFunction(() => 'fixture' in window);
  return frame;
}

test('same document: discover and call with validated input and output', async ({ page }, info) => {
  await open(page, 'publisher', info);
  const tool = (await tools(page)).find((t: any) => t.webmcpName === 'increment');
  expect(tool).toMatchObject({ name: 'self__increment', isSameDocument: true, origin: parentOrigin });
  expect(await call(page, tool.name, { n: 2 })).toEqual({ ok: true, value: 3 });
  expect(await call(page, tool.name, { n: 'wrong' })).toMatchObject({ ok: false,
    error: { kind: 'tool_failed', failure: { kind: 'input_invalid', handlerCalled: false } } });
  const broken = (await tools(page)).find((t: any) => t.webmcpName === 'invalid_output');
  expect(await call(page, broken.name)).toMatchObject({ ok: false,
    error: { kind: 'tool_failed', failure: { kind: 'output_invalid', handlerCalled: true } } });
  // The publisher validates output even though polyfill 0.1.0 drops outputSchema.
  if (info.project.name === 'polyfill') expect(tool.outputSchema).toBeUndefined();
});

test('unregister removes availability while an already running call completes (D16)', async ({ page }, info) => {
  await open(page, 'publisher', info);
  const tool = (await tools(page)).find((t: any) => t.webmcpName === 'wait');
  // Store the promise in the page so Playwright can drive the explicit gate.
  await page.evaluate(name => { const f = (window as any).fixture; f.pending = f.catalog.callTool(name); }, tool.name);
  await page.waitForFunction(() => (window as any).fixture.started);
  await page.evaluate(() => (window as any).fixture.abort());
  expect(await tools(page)).toEqual([]);
  expect(await call(page, tool.name)).toMatchObject({ error: { kind: 'unavailable' } });
  expect(await page.evaluate(() => (window as any).fixture.executionAborted)).toBe(false);
  await page.evaluate(() => (window as any).fixture.finish());
  expect(await page.evaluate(() => (window as any).fixture.pending)).toEqual({ ok: true, value: 17 });
});

test('same-origin iframe: source f1 keeps its catalog name after re-registration', async ({ page }, info) => {
  await open(page, 'agent', info);
  const frame = await attachFrame(page, parentOrigin, info.project.name, false);
  await expect.poll(async () => (await tools(page)).some((t: any) => t.webmcpName === 'frame_tool')).toBe(true);
  const tool = (await tools(page)).find((t: any) => t.webmcpName === 'frame_tool');
  expect(tool).toMatchObject({ name: 'f1__frame_tool', isSameDocument: false, origin: parentOrigin });
  expect(await call(page, tool.name)).toEqual({ ok: true, value: 'hello from frame' });
  await frame.evaluate(() => (window as any).fixture.unregister());
  await expect.poll(async () => (await tools(page)).some((t: any) => t.webmcpName === 'frame_tool')).toBe(false);
  await frame.evaluate(() => (window as any).fixture.register());
  await expect.poll(async () => (await tools(page)).find((t: any) => t.webmcpName === 'frame_tool')?.name).toBe(tool.name);
  expect(await call(page, tool.name)).toEqual({ ok: true, value: 'hello from frame' });
});

test('cross-origin iframe: exposure and requested origin are both necessary', async ({ page }, info) => {
  await open(page, 'agent', info);
  await attachFrame(page, frameOrigin, info.project.name, true);
  expect((await tools(page)).some((t: any) => t.webmcpName === 'frame_tool')).toBe(false);
  await page.evaluate(origin => (window as any).fixture.catalog.update({ fromOrigins: [origin] }), frameOrigin);
  await expect.poll(async () => (await tools(page)).some((t: any) => t.webmcpName === 'frame_tool')).toBe(true);
  const tool = (await tools(page)).find((t: any) => t.webmcpName === 'frame_tool');
  expect(tool).toMatchObject({ origin: frameOrigin, isSameDocument: false });
  expect(await call(page, tool.name)).toEqual({ ok: true, value: 'hello from frame' });
});

test('cross-origin iframe: an unexposed tool stays absent even when its origin is requested', async ({ page }, info) => {
  await open(page, 'agent', info);
  await attachFrame(page, frameOrigin, info.project.name, false);
  await page.evaluate(origin => (window as any).fixture.catalog.update({ fromOrigins: [origin] }), frameOrigin);
  const discovered = await tools(page);
  // Same-document positive control prevents an empty/unsupported catalog from passing.
  expect(discovered.some((t: any) => t.webmcpName === 'increment')).toBe(true);
  expect(discovered.some((t: any) => t.webmcpName === 'frame_tool')).toBe(false);
});

test('React StrictMode: refresh handlers without re-registering, then unmount', async ({ page }, info) => {
  await open(page, 'react', info);
  await expect(page.getByTestId('publication')).toHaveText('registered');
  await expect(page.getByTestId('catalog')).toHaveText('self__increment');
  const name = 'self__increment';
  expect(await call(page, name, { n: 2 })).toEqual({ ok: true, value: 3 });
  const registrations = await page.evaluate(() => (window as any).fixture.probe.registrations);
  await page.getByRole('button', { name: 'Refresh handler' }).click();
  await expect.poll(() => call(page, name, { n: 2 })).toEqual({ ok: true, value: 12 });
  expect(await page.evaluate(() => (window as any).fixture.probe.registrations)).toBe(registrations);
  await page.getByRole('button', { name: 'Unmount publisher' }).click();
  await expect(page.getByTestId('catalog')).toHaveText('');
  expect(await call(page, name)).toMatchObject({ error: { kind: 'unavailable' } });
  expect(await page.evaluate(() => (window as any).fixture.probe.errors)).not.toContain('duplicate_name');
});

test('AI SDK mock: model tool call routes through the catalog and receives its result', async ({ page }, info) => {
  await open(page, 'agent', info);
  const result = await page.evaluate(() => (window as any).fixture.deterministic());
  expect(result.modelCalls).toBe(2);
  expect(result.routed).toEqual([{ ok: true, value: 3 }]);
  expect(result.text).toContain('"value":3');
  expect(result.text).toContain('self__increment');
});

test('real model (opt-in): the same catalog loop with OpenAI', async ({ page }, info) => {
  await open(page, 'agent', info);
  test.skip(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is not set; no real provider call made');
  test.setTimeout(60_000);
  // Provider stays in Node. The browser only sees the language-model protocol.
  const { createOpenAI } = await import('@ai-sdk/openai');
  const model = createOpenAI().chat(process.env.WEBMCP_MODEL ?? 'gpt-4.1-mini');
  await page.exposeFunction('providerGenerate', (options: any) => model.doGenerate(options));
  const result = await page.evaluate(() => (window as any).fixture.real());
  expect(result.routed).toEqual([{ ok: true, value: 3 }]);
  expect(result.text).toContain('3');
});
