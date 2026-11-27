import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadHarness: vi.fn(), createModel: vi.fn() }));

vi.mock("@leren/agents", () => ({
  loadHarness: mocks.loadHarness,
  createModel: mocks.createModel,
}));

const { getJudgeModel } = await import("./judge");

const model = (modelId: string, apiKeyEnv: string) => ({
  provider: "openai",
  modelId,
  apiKeyEnv,
  baseUrl: "https://gateway.test/v1",
  api: "chat",
});

const config = {
  defaultModel: "deepseek",
  models: {
    deepseek: model("deepseek-chat", "DEEPSEEK_KEY"),
    "gpt-6-luna-gateway": model("gpt-6-luna", "GATEWAY_KEY"),
    "gpt-5-mini": model("gpt-5-mini", "OPENAI_KEY"),
  },
};

describe("getJudgeModel", () => {
  const completion = vi.fn(async () => ({ text: "ok" }));

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("EVAL_JUDGE_MODEL", "");
    vi.stubEnv("REPLY_MODEL", "");
    vi.stubEnv("GATEWAY_KEY", "");
    vi.stubEnv("OPENAI_KEY", "");
    mocks.loadHarness.mockResolvedValue({ config });
    mocks.createModel.mockReturnValue({ provider: "openai", modelId: "judge", completion });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the first preferred model whose key is set and that is not under evaluation", async () => {
    vi.stubEnv("REPLY_MODEL", "gpt-6-luna-gateway");
    vi.stubEnv("GATEWAY_KEY", "g");
    vi.stubEnv("OPENAI_KEY", "o");

    await getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] });

    expect(mocks.createModel).toHaveBeenCalledExactlyOnceWith({
      apiKey: "o",
      modelId: "gpt-5-mini",
      baseUrl: "https://gateway.test/v1",
      api: "chat",
    });
  });

  it("uses the model that EVAL_JUDGE_MODEL names", async () => {
    vi.stubEnv("EVAL_JUDGE_MODEL", "gpt-6-luna-gateway");
    vi.stubEnv("GATEWAY_KEY", "g");

    await getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] });

    expect(mocks.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "gpt-6-luna" }),
    );
  });

  it("never sends a temperature to the judge", async () => {
    vi.stubEnv("GATEWAY_KEY", "g");

    const judge = await getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] });

    await judge.completion({ prompt: "Grade", temperature: 0 } as never, {} as never);

    expect(completion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Grade", temperature: undefined }),
      {},
    );
  });

  it("refuses to grade with a model under evaluation, which follows the default model when unset", async () => {
    vi.stubEnv("EVAL_JUDGE_MODEL", "deepseek");
    vi.stubEnv("DEEPSEEK_KEY", "d");

    await expect(getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] })).rejects.toThrow(
      'The judge model "deepseek" is also a model under evaluation',
    );
  });

  it("names the models to choose from when none is usable", async () => {
    await expect(getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] })).rejects.toThrow(
      "Set EVAL_JUDGE_MODEL to one of: deepseek, gpt-6-luna-gateway, gpt-5-mini",
    );
  });

  it("names the variable that a requested judge model needs", async () => {
    vi.stubEnv("EVAL_JUDGE_MODEL", "gpt-5-mini");

    await expect(getJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] })).rejects.toThrow(
      'The judge model "gpt-5-mini" needs OPENAI_KEY to be set.',
    );
  });
});
