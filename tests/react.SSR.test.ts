import { expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { defineTool, implementTool } from '../src/index.js';
import { useRegisterTools, useToolCatalog } from '../src/react/index.js';
it('SSR does not access document and reports the initial states', () => {
  Object.defineProperty(globalThis, 'document', { configurable: true, get() { throw Error('document accessed'); } });
  const tool = implementTool(defineTool({ name: 'ssr', description: 'SSR' }), () => 1);
  function App() { expect(useRegisterTools([tool]).supported).toBeUndefined(); expect(useToolCatalog().status).toBe('idle'); return h('span', null, 'SSR'); }
  try { expect(renderToString(h(App))).toBe('<span>SSR</span>'); } finally { delete (globalThis as any).document; }
});
