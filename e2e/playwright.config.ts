import { defineConfig, devices } from "@playwright/test";

// Isolated ports/DB so this suite never touches your regular dev servers or dev DB —
// see backend/.env.e2e.local and frontend/.env.e2e.local.
const BASE_URL = "http://localhost:5174";

export default defineConfig({
  testDir: "./specs",
  // Round-robin lead assignment (BullMQ) can take 15-20s+ to settle in this dev
  // environment, and Leads — Sales Rep polls for it — give tests enough headroom.
  timeout: 60_000,
  fullyParallel: false,
  // All specs share one E2E org/DB (see backend/prisma/seed-e2e.ts), and the app's
  // real-time layer broadcasts toasts org-wide — running multiple spec files
  // concurrently lets one test's "New lead" toast overlap and intercept clicks in
  // another test's browser tab. Keep this suite fully serial.
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    // A missing control fails in seconds instead of burning the whole 60s test timeout (default is no action timeout).
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: "../backend",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "npm run dev:e2e",
      cwd: "../frontend",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: "setup", testDir: ".", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testDir: "./specs",
      testIgnore: /mfg\//,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      testDir: "./specs",
      testIgnore: /mfg\//,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
    },
    {
      name: "mfg",
      testDir: "./specs/mfg",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      dependencies: ["setup"],
    },
    {
      name: "mfg-mobile",
      testDir: "./specs/mfg",
      grep: /@responsive/,
      use: { ...devices["Pixel 5"] },
      dependencies: ["setup"],
    },
  ],
});
