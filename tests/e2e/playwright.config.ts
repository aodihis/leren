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
 * Settings that the API reads from the development `.env` file through `--env-file-if-exists`. The
 * file can hold encrypted values, and Node does not override a variable that is already set, so
 * each one is set here to a value that turns its feature off or satisfies the validation. The tests
 * then behave the same with or without that file, and never reach a real Lens server or provider.
 */
const NEUTRAL_ENVIRONMENT = {
  EMAIL_FROM: "Leren <noreply@example.com>",
  GOOGLE_CLIENT_ID: "unused",
  GOOGLE_CLIENT_SECRET: "unused",
  CHANNEL_PROVIDERS: "",
  CHANNEL_TOKEN_ENCRYPTION_KEY: "",
  EMBEDDING_MODEL: "",
  EMBEDDING_API_KEY: "",
  KNOWLEDGE_DRIFT_INTERVAL_MINUTES: "",
  ANVIA_LENS_BASE_URL: "",
  ANVIA_LENS_PUBLIC_KEY: "",
  ANVIA_LENS_SECRET_KEY: "",
  ANVIA_LENS_MEDIA_UPLOAD_ENABLED: "",
  ANVIA_LENS_SERVICE_NAME: "",
  ANVIA_LENS_ENVIRONMENT: "",
  ASSISTANT_MODEL: "",
  REPLY_MODEL: "",
  REPLY_TRIAGE_MODEL: "",
  REPLY_JUDGE_MODEL: "",
  DEEPSEEK_API_KEY: "",
  DEVSCALE_GATEWAY_API_KEY: "",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "",
  OPENAI_BASE_URL: "",
  OPENAI_API: "",
  MCP_URL: "",
  MCP_TOKEN: "",
};

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
        ...NEUTRAL_ENVIRONMENT,
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
