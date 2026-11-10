import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real web app against the local Supabase stack (`pnpm db:start`).
// They assume the seeded demo data, so run `pnpm db:reset` first for a clean pass.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: process.env.CI ? "pnpm exec next build && pnpm exec next start -p 3000" : "pnpm exec next dev -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
