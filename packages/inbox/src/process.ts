import { z } from "zod";

/** What the gate found for one playbook. */
export const playbookVerdictSchema = z.object({
  playbookId: z.uuid(),
  verdict: z.enum(["handle", "check_mention"]),
});

/** The message of email.process. */
export const emailProcessMessageSchema = z.object({
  messageId: z.uuid(),
  playbooks: z.array(playbookVerdictSchema).min(1),
});

export type EmailProcessMessage = z.infer<typeof emailProcessMessageSchema>;
