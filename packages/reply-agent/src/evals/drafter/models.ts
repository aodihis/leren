import type { CompletionModel } from "@anvia/core";
import { getJudgeModel as selectJudgeModel } from "@leren/evals";

/** Builds the model that grades the drafter's answers. It differs from the drafter's model. */
export async function getJudgeModel(): Promise<CompletionModel> {
  return selectJudgeModel({ agentModelEnvs: ["REPLY_MODEL"] });
}
