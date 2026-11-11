import { platform } from './platform';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { implementTool } from 'webmcp-sdk';
import { useRegisterTools, useToolCatalog } from 'webmcp-sdk/react';
import { increment } from './tools';
if (platform.available) {
  const probe = { registrations: 0, errors: [] as string[] };
  // Observe the real platform; delegation and behavior still go through its API.
  const context = (document as any).modelContext;
  const original = context.registerTool.bind(context);
  context.registerTool = (...args: any[]) => { probe.registrations++; return original(...args); };
  function Publisher({ offset }: { offset: number }) {
    const state = useRegisterTools([implementTool(increment, ({ n }) => n + offset)]);
    probe.errors.push(...state.tools.flatMap(t => t.error ? [t.error.code] : []));
    return <output data-testid="publication">{state.tools.map(t => t.state).join(',')}</output>;
  }
  function Consumer() {
    const { catalog, tools } = useToolCatalog();
    Object.assign(window, { fixture: { catalog, probe } });
    return <output data-testid="catalog">{tools.map(t => t.name).join(',')}</output>;
  }
  function App() {
    const [offset, setOffset] = useState(1);
    const [mounted, setMounted] = useState(true);
    return <><button onClick={() => setOffset(10)}>Refresh handler</button>
      <button onClick={() => setMounted(false)}>Unmount publisher</button>
      {mounted && <Publisher offset={offset} />}<Consumer /></>;
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
