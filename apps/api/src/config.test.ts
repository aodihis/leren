import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://leren:leren@localhost:54329/leren",
  BETTER_AUTH_SECRET: "x".repeat(32),
  RABBITMQ_URL: "amqp://leren:leren@localhost:56720",
  REDIS_URL: "redis://localhost:56379",
  SMTP_URL: "smtp://localhost:51025",
  MCP_SESSION_SECRET: "m".repeat(32),
  VECTOR_STORE_URL: "http://localhost:16333",
};

describe("loadConfig", () => {
  it("applies defaults for the optional variables", () => {
    const config = loadConfig(validEnv);

    expect(config.PORT).toBe(3000);
    expect(config.PLATFORM_URL).toBe("http://localhost:5173");
  });

  it("lists every invalid variable in one error", () => {
    expect(() => loadConfig({ BETTER_AUTH_SECRET: "short" })).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*MCP_SESSION_SECRET[\s\S]*RABBITMQ_URL[\s\S]*SMTP_URL/,
    );
  });

  describe("channel providers", () => {
    const key = Buffer.alloc(32, 1).toString("base64");

    const google = {
      CHANNEL_PROVIDERS: "google",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      CHANNEL_TOKEN_ENCRYPTION_KEY: key,
    };

    it("enables no provider by default", () => {
      expect(loadConfig(validEnv).CHANNEL_PROVIDERS).toEqual([]);
    });

    it("reads a comma-separated list and ignores spaces", () => {
      const config = loadConfig({
        ...validEnv,
        ...google,
        CHANNEL_PROVIDERS: " google , mailpit ",
      });

      expect(config.CHANNEL_PROVIDERS).toEqual(["google", "mailpit"]);
    });

    it("rejects an unknown provider name", () => {
      expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "gogle" })).toThrow(
        /CHANNEL_PROVIDERS/,
      );
    });

    it("requires the settings of an enabled provider and none for a provider that is off", () => {
      expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "google" })).toThrow(
        /GOOGLE_CLIENT_ID[\s\S]*GOOGLE_CLIENT_SECRET[\s\S]*CHANNEL_TOKEN_ENCRYPTION_KEY/,
      );
      expect(() => loadConfig({ ...validEnv, ...google })).not.toThrow();
      expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "mailpit" })).not.toThrow();
    });

    it("rejects an encryption key that is not 32 bytes", () => {
      expect(() =>
        loadConfig({ ...validEnv, ...google, CHANNEL_TOKEN_ENCRYPTION_KEY: "c2hvcnQ=" }),
      ).toThrow(/CHANNEL_TOKEN_ENCRYPTION_KEY/);
    });

    it("refuses mailpit in production", () => {
      expect(() =>
        loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "mailpit", NODE_ENV: "production" }),
      ).toThrow(/mailpit/);
    });
  });
});
