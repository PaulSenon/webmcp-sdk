import { defineConfig } from '@playwright/test';
const parentPort = Number(process.env.WEBMCP_PORT ?? 4173);
const framePort = Number(process.env.WEBMCP_FRAME_PORT ?? 4174);
export const parentOrigin = `http://localhost:${parentPort}`;
export const frameOrigin = `http://127.0.0.1:${framePort}`;
export default defineConfig({
  testDir: './e2e', testMatch: '*.spec.ts', fullyParallel: true,
  timeout: 30_000, expect: { timeout: 10_000 },
  outputDir: 'test-results', reporter: [['list']],
  use: { browserName: 'chromium', baseURL: parentOrigin, trace: 'retain-on-failure' },
  projects: [
    { name: 'polyfill' },
    ...(process.env.WEBMCP_NATIVE === '1' ? [{ name: 'native', use: {
      ...(process.env.WEBMCP_NATIVE_CHANNEL ? { channel: process.env.WEBMCP_NATIVE_CHANNEL } : {}),
      launchOptions: { args: ['--enable-features=WebMCP'] },
    } }] : []),
  ],
  webServer: [parentPort, framePort].map(port => ({
    command: `pnpm exec vite --config vite.e2e.config.ts --port ${port}`,
    url: `http://127.0.0.1:${port}/publisher.html`, reuseExistingServer: false,
  })),
});
