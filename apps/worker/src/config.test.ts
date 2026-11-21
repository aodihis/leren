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

  it("lists every missing variable in one error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*VECTOR_STORE_URL[\s\S]*RABBITMQ_URL/);
  });
});
