import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findHarnessConfig, loadHarness } from "./harness";

const CONFIG = `export default {
  prompts: { assistant: "prompts/assistant.md", reply: "prompts/reply.md" },
  models: {
    small: {
      provider: "openai",
      modelId: "small-1",
      apiKeyEnv: "TEST_KEY",
      baseUrl: "https://gateway.test/v1",
      api: "chat",
      contextWindow: 1000,
      maxOutputTokens: 100,
      reasoningEfforts: [],
    },
  },
  defaultModel: "small",
  pluginsDir: "plugins",
};
`;

const paths = { root: "" };

beforeEach(async () => {
  paths.root = await mkdtemp(join(tmpdir(), "harness-"));
  await mkdir(join(paths.root, "prompts"));
  await mkdir(join(paths.root, "nested", "deeper"), { recursive: true });
  await writeFile(join(paths.root, "prompts", "reply.md"), "Reply prompt.");
  await writeFile(join(paths.root, "harness.config.ts"), CONFIG);
});

afterEach(async () => {
  await rm(paths.root, { recursive: true, force: true });
});

describe("findHarnessConfig", () => {
  it("finds the config in a parent directory", () => {
    expect(findHarnessConfig(join(paths.root, "nested", "deeper"))).toBe(
      join(paths.root, "harness.config.ts"),
    );
  });
});

describe("loadHarness", () => {
  it("loads the config, resolves paths against its directory and reads prompts", async () => {
    const harness = await loadHarness({
      startDir: join(paths.root, "nested"),
      env: { TEST_KEY: "key" },
    });

    expect(harness.rootDir).toBe(paths.root);
    expect(harness.pluginsDir).toBe(join(paths.root, "plugins"));
    expect(await harness.readPrompt("reply")).toBe("Reply prompt.");
    expect(harness.createModel("reply")).toBeDefined();
  });

  it("reports a missing API key and an unknown model", async () => {
    const missingKey = await loadHarness({ startDir: paths.root, env: {} });

    const unknownModel = await loadHarness({
      startDir: paths.root,
      env: { TEST_KEY: "key", REPLY_MODEL: "other" },
    });

    expect(() => missingKey.createModel("reply")).toThrow("TEST_KEY is not set");
    expect(() => unknownModel.createModel("reply")).toThrow('REPLY_MODEL="other"');
  });

  it("rejects a default model that is not configured", async () => {
    await writeFile(
      join(paths.root, "harness.config.ts"),
      CONFIG.replace('defaultModel: "small"', 'defaultModel: "missing"'),
    );

    await expect(loadHarness({ startDir: paths.root })).rejects.toThrow('"missing"');
  });

  it("rejects a default reasoning effort the model does not support", async () => {
    await writeFile(
      join(paths.root, "harness.config.ts"),
      CONFIG.replace("reasoningEfforts: []", 'reasoningEfforts: [], defaultReasoningEffort: "low"'),
    );

    await expect(loadHarness({ startDir: paths.root })).rejects.toThrow("reasoning effort");
  });
});
