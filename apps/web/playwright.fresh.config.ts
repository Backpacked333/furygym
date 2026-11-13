import { defineConfig, devices } from "@playwright/test";

// Fresh-install check: the web app against a database with migrations only and no seed data
// (`pnpm exec supabase db reset --no-seed`), which is what production starts from.
// Run `pnpm db:reset` afterwards to get the demo data back.
export default defineConfig({
  testDir: "./e2e-fresh",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    // In CI the seeded browser suite has already built the app; build only if it has not.
    command: process.env.CI ? "(test -f .next/BUILD_ID || pnpm exec next build) && pnpm exec next start -p 3000" : "pnpm exec next dev -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
