import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findHarnessConfig, loadHarness } from "./harness";

const CONFIG = `export default {
  prompts: {
    assistant: "prompts/assistant.md",
    reply: "prompts/reply.md",
    replyTriage: "prompts/reply-triage.md",
    replyJudge: "prompts/reply-judge.md",
    replyStyle: "prompts/reply-style.md",
    replyStyleJudge: "prompts/reply-style-judge.md",
  },
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
    thinker: {
      provider: "openai",
      modelId: "thinker-1",
      apiKeyEnv: "TEST_KEY",
      baseUrl: "https://gateway.test/v1",
      api: "chat",
      contextWindow: 1000,
      maxOutputTokens: 100,
      reasoningEfforts: ["minimal", "low"],
      defaultReasoningEffort: "low",
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

  it("calls a model with the effort it is asked for when it lists it, and else with its default", async () => {
    const harness = await loadHarness({ startDir: paths.root, env: { TEST_KEY: "key" } });
    const minimal = harness.model("thinker", "minimal");

    expect(minimal.model.controls?.reasoningEffort?.options).toEqual(["minimal", "low"]);
    expect(minimal.controls).toEqual({ reasoningEffort: "minimal" });
    expect(harness.model("thinker").controls).toEqual({ reasoningEffort: "low" });
    expect(harness.model("thinker", "high").controls).toEqual({ reasoningEffort: "low" });
    expect(harness.model("small", "minimal").controls).toBeUndefined();
    expect(harness.model("thinker", "minimal")).toBe(minimal);
    expect(() => harness.model("other")).toThrow('"other" is not a model in the harness');
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

  it("rejects a model that lists reasoning efforts without a default", async () => {
    await writeFile(
      join(paths.root, "harness.config.ts"),
      CONFIG.replace('      defaultReasoningEffort: "low",\n', ""),
    );

    await expect(loadHarness({ startDir: paths.root })).rejects.toThrow(
      '"thinker" lists reasoning efforts but has no default reasoning effort.',
    );
  });
});
