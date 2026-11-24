import { describe, expect, it } from "vitest";
import { defineHarnessConfig, resolveEmbeddingModel, resolveTaskModel } from "./config";

const config = defineHarnessConfig({
  prompts: {
    assistant: "a.md",
    reply: "r.md",
    replyTriage: "t.md",
    replyRoute: "o.md",
    replyJudge: "j.md",
  },
  models: {
    fast: {
      provider: "openai",
      modelId: "fast-1",
      apiKeyEnv: "FAST_KEY",
      contextWindow: 1000,
      maxOutputTokens: 100,
      reasoningEfforts: [],
    },
    smart: {
      provider: "openai",
      modelId: "smart-1",
      apiKeyEnv: "SMART_KEY",
      contextWindow: 1000,
      maxOutputTokens: 100,
      reasoningEfforts: [],
    },
  },
  defaultModel: "fast",
  embeddingModels: {
    small: {
      provider: "openai",
      modelId: "embed-1",
      apiKeyEnv: "EMBED_KEY",
      baseUrl: "https://embed.test/v1",
      dimensions: 8,
    },
  },
  defaultEmbeddingModel: "small",
  pluginsDir: "plugins",
});

describe("resolveTaskModel", () => {
  it("uses the key named by the task variable", () => {
    const resolved = resolveTaskModel(config, "reply", { REPLY_MODEL: "smart", SMART_KEY: "s" });

    expect(resolved.key).toBe("smart");
    expect(resolved.definition.modelId).toBe("smart-1");
    expect(resolved.apiKey).toBe("s");
  });

  it("falls back to the default model when the variable is empty", () => {
    const resolved = resolveTaskModel(config, "assistant", { ASSISTANT_MODEL: "", FAST_KEY: "f" });

    expect(resolved.key).toBe("fast");
  });

  it("lets the judge follow REPLY_MODEL until REPLY_JUDGE_MODEL is set", () => {
    const env = { REPLY_MODEL: "smart", SMART_KEY: "s", FAST_KEY: "f" };

    expect(resolveTaskModel(config, "replyJudge", env).key).toBe("smart");
    expect(resolveTaskModel(config, "replyJudge", { ...env, REPLY_JUDGE_MODEL: "fast" }).key).toBe(
      "fast",
    );
  });

  it("names REPLY_MODEL when the judge follows it and the key is unknown", () => {
    expect(() => resolveTaskModel(config, "replyJudge", { REPLY_MODEL: "typo" })).toThrow(
      /REPLY_MODEL="typo"/,
    );
  });

  it("lists the available keys when the key is unknown", () => {
    expect(() => resolveTaskModel(config, "reply", { REPLY_MODEL: "nope" })).toThrow(
      /REPLY_MODEL="nope".*fast, smart/,
    );
  });

  it("names the missing API key variable", () => {
    expect(() => resolveTaskModel(config, "assistant", {})).toThrow(/FAST_KEY is not set/);
  });
});

describe("resolveEmbeddingModel", () => {
  it("uses the default embedding model when the variable is empty", () => {
    const resolved = resolveEmbeddingModel(config, { EMBEDDING_MODEL: "", EMBED_KEY: "e" });

    expect(resolved.key).toBe("small");
    expect(resolved.definition.dimensions).toBe(8);
    expect(resolved.apiKey).toBe("e");
  });

  it("lists the available keys when the key is unknown", () => {
    expect(() => resolveEmbeddingModel(config, { EMBEDDING_MODEL: "nope" })).toThrow(
      /EMBEDDING_MODEL="nope".*small/,
    );
  });

  it("names the missing API key variable", () => {
    expect(() => resolveEmbeddingModel(config, {})).toThrow(/EMBED_KEY is not set/);
  });
});
