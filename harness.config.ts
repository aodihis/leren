import { defineHarnessConfig } from "@leren/agents";

/**
 * The configuration of the agent harness.
 *
 * Each agent's system prompt is a markdown file, the models list what an agent can run on, and
 * every directory in `pluginsDir` that has a `manifest.json` registers additional tools.
 */
export default defineHarnessConfig({
  prompts: {
    assistant: "prompts/assistant.md",
    reply: "prompts/reply.md",
    replyTriage: "prompts/reply-triage.md",
    replyJudge: "prompts/reply-judge.md",
    replyStyle: "prompts/reply-style.md",
    replyStyleJudge: "prompts/reply-style-judge.md",
  },
  models: {
    "gpt-5": {
      provider: "openai",
      modelId: "gpt-5",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ["minimal", "low", "medium", "high"],
      defaultReasoningEffort: "medium",
    },
    "gpt-5-mini": {
      provider: "openai",
      modelId: "gpt-5-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ["minimal", "low", "medium", "high"],
      defaultReasoningEffort: "low",
    },
    "deepseek-fast": {
      provider: "openai",
      modelId: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      baseUrl: "https://api.deepseek.com",
      api: "chat",
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
      reasoningEfforts: [],
    },
    "deepseek-v4-flash-gateway": {
      provider: "openai",
      modelId: "deepseek-v4-flash-0731",
      apiKeyEnv: "DEVSCALE_GATEWAY_API_KEY",
      baseUrl: "https://gateway.devscale.id/v1",
      api: "chat",
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
      reasoningEfforts: [],
    },
    "gpt-6-luna-gateway": {
      provider: "openai",
      modelId: "gpt-6-luna",
      apiKeyEnv: "DEVSCALE_GATEWAY_API_KEY",
      baseUrl: "https://gateway.devscale.id/v1",
      api: "chat",
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
      reasoningEfforts: [],
    },
    "glm-5.3-gateway": {
      provider: "openai",
      modelId: "glm-5.3",
      apiKeyEnv: "DEVSCALE_GATEWAY_API_KEY",
      baseUrl: "https://gateway.devscale.id/v1",
      api: "chat",
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
      reasoningEfforts: [],
    },
  },
  defaultModel: "deepseek-fast",
  embeddingModels: {
    "openrouter-embedding-small": {
      provider: "openai",
      modelId: "openai/text-embedding-3-small",
      apiKeyEnv: "EMBEDDING_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      dimensions: 1536,
    },
  },
  defaultEmbeddingModel: "openrouter-embedding-small",
  pluginsDir: "plugins",
});
