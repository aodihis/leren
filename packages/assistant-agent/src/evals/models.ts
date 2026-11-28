import type { CompletionModel } from "@anvia/core";
import { loadHarness } from "@leren/agents";
import type { HarnessModel } from "@leren/agents";
import { getJudgeModel as selectJudgeModel } from "@leren/evals";
import { ASSISTANT_REASONING_EFFORT } from "../agent";

/**
 * Builds the model that the Assistant Agent runs on during an eval and the controls to call it
 * with. They are the ones the product uses, so an eval measures the product's model and effort.
 */
export async function getAgentModel(): Promise<HarnessModel> {
  const harness = await loadHarness();

  return harness.taskModel("assistant", ASSISTANT_REASONING_EFFORT);
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
