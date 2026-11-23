import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://leren:leren@localhost:54329/leren",
  VECTOR_STORE_URL: "http://localhost:16333",
  RABBITMQ_URL: "amqp://leren:leren@localhost:56720",
};

describe("loadConfig", () => {
  it("reads the reply model key as optional", () => {
    expect(loadConfig(validEnv).REPLY_MODEL).toBeUndefined();
    expect(loadConfig({ ...validEnv, REPLY_MODEL: "fast" }).REPLY_MODEL).toBe("fast");
  });

  it("reads the MCP settings of the reply pipeline and requires a long secret", () => {
    const config = loadConfig(validEnv);

    expect(config.MCP_SESSION_SECRET).toBeUndefined();
    expect(config.MCP_URL).toBe("http://localhost:3000/mcp");
    expect(() => loadConfig({ ...validEnv, MCP_SESSION_SECRET: "short" })).toThrow(
      /MCP_SESSION_SECRET/,
    );
  });

  it("reads empty MCP variables as not set", () => {
    const config = loadConfig({ ...validEnv, MCP_SESSION_SECRET: "", MCP_URL: "" });

    expect(config.MCP_SESSION_SECRET).toBeUndefined();
    expect(config.MCP_URL).toBe("http://localhost:3000/mcp");
  });

  it("reads the poll interval in seconds and defaults it to one minute", () => {
    expect(loadConfig(validEnv).EMAIL_POLL_INTERVAL_SECONDS).toBe(60);
    expect(
      loadConfig({ ...validEnv, EMAIL_POLL_INTERVAL_SECONDS: "5" }).EMAIL_POLL_INTERVAL_SECONDS,
    ).toBe(5);
  });

  it("requires the settings of an enabled provider", () => {
    expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "google" })).toThrow(
      /GOOGLE_CLIENT_ID[\s\S]*GOOGLE_CLIENT_SECRET[\s\S]*CHANNEL_TOKEN_ENCRYPTION_KEY/,
    );
    expect(() => loadConfig({ ...validEnv, CHANNEL_PROVIDERS: "unknown" })).toThrow(
      /CHANNEL_PROVIDERS/,
    );
  });

  it("lists every missing variable in one error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*VECTOR_STORE_URL[\s\S]*RABBITMQ_URL/);
  });
});
