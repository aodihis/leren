import { defineConfig, devices } from "@playwright/test";

import {
  API_PORT,
  API_URL,
  PLATFORM_PORT,
  PLATFORM_URL,
  RABBITMQ_URL,
  SMTP_URL,
} from "./support/config";
import { getE2eDatabaseUrl } from "./support/database";

/**
 * Playwright configuration. The tests start their own API and platform on ports that differ from
 * the development ports, against a dedicated database, so they can run next to `pnpm dev`.
 * PostgreSQL and Mailpit must be running: start them with `pnpm services:up`.
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: PLATFORM_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec tsx support/reset-database.ts && pnpm --filter @leren/api start",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        API_URL,
        PLATFORM_URL,
        DATABASE_URL: getE2eDatabaseUrl(),
        BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0000",
        RABBITMQ_URL,
        SMTP_URL,
        MCP_SESSION_SECRET: "e2e-mcp-secret-e2e-mcp-secret-0000",
        VECTOR_STORE_URL: "http://localhost:16333",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `pnpm --filter @leren/platform exec vite --port ${PLATFORM_PORT} --strictPort`,
      url: PLATFORM_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_URL },
    },
  ],
});
