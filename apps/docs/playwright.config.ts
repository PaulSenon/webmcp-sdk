import { defineConfig, devices } from "@playwright/test";

// Smoke tests of the built site (out/), served the way the production host serves it.
// Run `pnpm build` first; `pnpm test:e2e` does not build.
const port = 4322;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/preview.mjs",
    env: { PORT: String(port) },
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
  },
});
