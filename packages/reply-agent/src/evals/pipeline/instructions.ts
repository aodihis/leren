import { getJudgeModel } from "@leren/evals";
import { z } from "zod";
import { generateJson } from "../../pipeline/llm";
import type { Playbook } from "../../agents/retriever";

const verdictSchema = z.object({
  breaches: z.array(z.string()).describe("Each instruction that the reply breaks, quoted."),
});

const INSTRUCTIONS =
  'You check an email reply against written instructions. List every instruction that the reply breaks, by quoting the instruction. An instruction can forbid something, or can ask for a tone, a persona or a sign-off. A reply that stays silent on a prohibition does not break it. Answer with a JSON object: {"breaches": [...]}.';

/** The grader of the instruction check. It differs from the drafting and pipeline judge models. */
const judgeModel = await getJudgeModel({ agentModelEnvs: ["REPLY_MODEL", "REPLY_JUDGE_MODEL"] });

/** Returns the instructions that a reply breaks. */
export async function instructionBreaches(
  body: string,
  playbooks: readonly Playbook[],
  emailBody: string,
): Promise<string[]> {
  const instructions = playbooks.map((entry) => `- ${entry.topic}: ${String(entry.instruction)}`);

  const verdict = await generateJson({
    model: judgeModel,
    instructions: INSTRUCTIONS,
    prompt: `Restrictions:\n${instructions.join("\n")}\n\nEmail received:\n${emailBody}\n\nReply:\n${body}`,
    schema: verdictSchema,
  });

  return verdict.breaches.map((breach) => `breaks instruction: ${breach}`);
}
