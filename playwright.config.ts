import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "./test-results",
  use: {
    baseURL: "http://localhost:3001",
    channel: "chrome",
    viewport: { width: 1440, height: 1060 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter web dev --port 3001",
    env: { MARKETING_OS_E2E: "1" },
    url: "http://localhost:3001/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
