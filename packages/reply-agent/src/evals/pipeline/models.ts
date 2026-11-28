import type { CompletionModel } from "@anvia/core";
import { getJudgeModel as selectJudgeModel } from "@leren/evals";

/**
 * Builds the model that grades the pipeline's replies. It differs from every model that the
 * pipeline runs on: the answering agent, triage and the pipeline's own judges.
 */
export async function getJudgeModel(): Promise<CompletionModel> {
  return selectJudgeModel({
    agentModelEnvs: ["REPLY_MODEL", "REPLY_TRIAGE_MODEL", "REPLY_JUDGE_MODEL"],
  });
}
