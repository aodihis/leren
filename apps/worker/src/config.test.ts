import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

const validEnv = {
  DATABASE_URL: "postgres://leren:leren@localhost:54329/leren",
  VECTOR_STORE_URL: "http://localhost:16333",
  RABBITMQ_URL: "amqp://leren:leren@localhost:56720",
  EMBEDDING_API_KEY: "key",
};

describe("loadConfig", () => {
  it("applies the OpenRouter defaults for the embedding model", () => {
    const config = loadConfig(validEnv);

    expect(config.EMBEDDING_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(config.EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
    expect(config.EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("reads the embedding dimensions as a number", () => {
    expect(loadConfig({ ...validEnv, EMBEDDING_DIMENSIONS: "768" }).EMBEDDING_DIMENSIONS).toBe(768);
  });

  it("lists every missing variable in one error", () => {
    expect(() => loadConfig({})).toThrow(
      /DATABASE_URL[\s\S]*VECTOR_STORE_URL[\s\S]*RABBITMQ_URL[\s\S]*EMBEDDING_API_KEY/,
    );
  });
});
