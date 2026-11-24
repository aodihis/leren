import { z } from "zod";
import { generateJson } from "../pipeline/llm";
import type { Playbook } from "../pipeline";
import { sharedDeps } from "./target";

const verdictSchema = z.object({
  breaches: z.array(z.string()).describe("Each restriction that the reply breaks, quoted."),
});

const INSTRUCTIONS =
  'You check an email reply against written restrictions. List every restriction that the reply breaks, by quoting the restriction. A reply that stays silent on a restriction does not break it. Answer with a JSON object: {"breaches": [...]}.';

/** Returns the restrictions that a reply breaks. */
export async function restrictionBreaches(
  body: string,
  playbooks: readonly Playbook[],
  emailBody: string,
): Promise<string[]> {
  const restrictions = playbooks.map((entry) => `- ${entry.topic}: ${String(entry.restrictions)}`);

  const verdict = await generateJson({
    model: sharedDeps.models.judge,
    instructions: INSTRUCTIONS,
    prompt: `Restrictions:\n${restrictions.join("\n")}\n\nEmail received:\n${emailBody}\n\nReply:\n${body}`,
    schema: verdictSchema,
  });

  return verdict.breaches.map((breach) => `breaks restriction: ${breach}`);
}
