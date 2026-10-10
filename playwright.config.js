// @ts-check
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.js/,
  timeout: 30_000,
  use: { baseURL: "http://localhost:3101", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/dev-server.mjs",
    port: 3101,
    env: { PORT: "3101", MEDIFINANCE_MOCK: "1" },
    reuseExistingServer: !process.env.CI,
  },
});
