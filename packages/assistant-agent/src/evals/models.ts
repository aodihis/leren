import type { CompletionModel } from "@anvia/core";
import { loadHarness } from "@leren/agents";
import { getJudgeModel as selectJudgeModel } from "@leren/evals";

/**
 * Builds the model that the Assistant Agent runs on during an eval. It is the model that
 * `ASSISTANT_MODEL` selects, so an eval measures the model that the product uses.
 */
export async function getAgentModel(): Promise<CompletionModel> {
  const harness = await loadHarness();

  return harness.createModel("assistant");
}

/** Reads the system prompt that the product gives the Assistant Agent. */
export async function getInstructions(): Promise<string> {
  const harness = await loadHarness();

  return harness.readPrompt("assistant");
}

/** Builds the model that grades answers. It differs from the assistant's model. */
export async function getJudgeModel(): Promise<CompletionModel> {
  return selectJudgeModel({ agentModelEnvs: ["ASSISTANT_MODEL"] });
}
