import { describe, expect, it } from "vitest";
import { defineHarnessConfig, resolveTaskModel } from "./config";

const config = defineHarnessConfig({
  prompts: { assistant: "a.md", reply: "r.md" },
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

  it("lists the available keys when the key is unknown", () => {
    expect(() => resolveTaskModel(config, "reply", { REPLY_MODEL: "nope" })).toThrow(
      /REPLY_MODEL="nope".*fast, smart/,
    );
  });

  it("names the missing API key variable", () => {
    expect(() => resolveTaskModel(config, "assistant", {})).toThrow(/FAST_KEY is not set/);
  });
});
