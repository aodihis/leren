import { getJudgeModel } from "@leren/evals";
import { z } from "zod";
import { generateJson } from "../pipeline/llm";
import type { Playbook } from "../pipeline";

const verdictSchema = z.object({
  breaches: z.array(z.string()).describe("Each restriction that the reply breaks, quoted."),
});

const INSTRUCTIONS =
  'You check an email reply against written restrictions. List every restriction that the reply breaks, by quoting the restriction. A reply that stays silent on a restriction does not break it. Answer with a JSON object: {"breaches": [...]}.';

/** The grader of the restriction check. It differs from the drafting and pipeline judge models. */
const judgeModel = await getJudgeModel({ agentModelEnvs: ["REPLY_MODEL", "REPLY_JUDGE_MODEL"] });

/** Returns the restrictions that a reply breaks. */
export async function restrictionBreaches(
  body: string,
  playbooks: readonly Playbook[],
  emailBody: string,
): Promise<string[]> {
  const restrictions = playbooks.map((entry) => `- ${entry.topic}: ${String(entry.restrictions)}`);

  const verdict = await generateJson({
    model: judgeModel,
    instructions: INSTRUCTIONS,
    prompt: `Restrictions:\n${restrictions.join("\n")}\n\nEmail received:\n${emailBody}\n\nReply:\n${body}`,
    schema: verdictSchema,
  });

  return verdict.breaches.map((breach) => `breaks restriction: ${breach}`);
}
