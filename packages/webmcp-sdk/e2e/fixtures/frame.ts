import { platform } from './platform';
import { defineTool, implementTool, registerTool } from 'webmcp-sdk';
if (platform.available) {
  const params = new URLSearchParams(location.search);
  const tool = implementTool(defineTool({ name: 'frame_tool', description: 'Identify this frame.' }), () => 'hello from frame');
  let lifetime = new AbortController();
  const register = () => registerTool(tool, { signal: lifetime.signal,
    ...(params.get('expose') === '1' ? { exposedTo: [params.get('parent')!] } : {}),
  });
  await register();
  Object.assign(window, { fixture: {
    unregister: () => lifetime.abort(),
    register: async () => { lifetime = new AbortController(); await register(); },
  } });
}
