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
  },
  models: {
    "gpt-5": {
      provider: "openai",
      modelId: "gpt-5",
      apiKeyEnv: "OPENAI_API_KEY",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ["minimal", "low", "medium", "high"],
      defaultReasoningEffort: "medium",
    },
    "gpt-5-mini": {
      provider: "openai",
      modelId: "gpt-5-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: ["minimal", "low", "medium", "high"],
      defaultReasoningEffort: "low",
    },
  },
  defaultModel: "gpt-5-mini",
  pluginsDir: "plugins",
});
