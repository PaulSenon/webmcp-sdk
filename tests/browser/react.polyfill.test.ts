/** Real Chromium with the official POLYFILL, not native WebMCP. */
import { expect, it } from 'vitest';
import { installWebMCP } from '@w3c/webmcp-polyfill';
import { act, createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineTool, implementTool } from '../../src/index.js';
import { useRegisterTools, useToolCatalog } from '../../src/react/index.js';
import type { UseToolCatalogResult } from '../../src/react/index.js';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('React StrictMode: register in publisher, discover/call in consumer, remove publisher', async () => {
  expect('modelContext' in Document.prototype).toBe(false); installWebMCP();
  const definition = defineTool({ name: 'react_roundtrip', description: 'React round trip' });
  let result!: UseToolCatalogResult;
  function Publisher() { useRegisterTools([implementTool(definition, () => 31)]); return null; }
  function Consumer() { result = useToolCatalog(); return null; }
  function App({ enabled }: { enabled: boolean }) { return h(StrictMode, null, enabled && h(Publisher), h(Consumer)); }
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  try {
    await act(async () => root.render(h(App, { enabled: true })));
    await act(async () => { await expect.poll(() => result.tools.some(t => t.webmcpName === definition.name)).toBe(true); });
    const catalog = result.catalog, tool = result.tools.find(t => t.webmcpName === definition.name)!;
    expect(await catalog.callTool(tool.name)).toEqual({ ok: true, value: 31 });
    await act(async () => root.render(h(App, { enabled: false })));
    await act(async () => { await expect.poll(() => result.tools.some(t => t.webmcpName === definition.name)).toBe(false); });
    expect(result.catalog).toBe(catalog);
    expect(await catalog.callTool(tool.name)).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  } finally { await act(async () => root.unmount()); element.remove(); }
});
