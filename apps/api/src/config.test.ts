import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://leren:leren@localhost:54329/leren",
  BETTER_AUTH_SECRET: "x".repeat(32),
  RABBITMQ_URL: "amqp://leren:leren@localhost:56720",
  SMTP_URL: "smtp://localhost:51025",
};

describe("loadConfig", () => {
  it("applies defaults for the optional variables", () => {
    const config = loadConfig(validEnv);

    expect(config.PORT).toBe(3000);
    expect(config.PLATFORM_URL).toBe("http://localhost:5173");
  });

  it("lists every invalid variable in one error", () => {
    expect(() => loadConfig({ BETTER_AUTH_SECRET: "short" })).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*RABBITMQ_URL[\s\S]*SMTP_URL/,
    );
  });
});
