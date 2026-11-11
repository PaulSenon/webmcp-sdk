import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: 'e2e/fixtures',
  resolve: { alias: [
    { find: '@senon/webmcp-sdk/react', replacement: fileURLToPath(new URL('./src/react/index.ts', import.meta.url)) },
    { find: '@senon/webmcp-sdk', replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
  ] },
  server: { host: '0.0.0.0', strictPort: true },
});
