import { z } from "zod";

/**
 * What the gate found for one playbook. `handle` means that the conditions pass. `check_mention`
 * means that they pass only if a model finds that the message addresses the user by name.
 */
export const playbookVerdictSchema = z.object({
  playbookId: z.uuid(),
  verdict: z.enum(["handle", "check_mention"]),
});

/** The message of `email.process`: the record and the playbooks that may reply to it. */
export const emailProcessMessageSchema = z.object({
  messageId: z.uuid(),
  playbooks: z.array(playbookVerdictSchema).min(1),
});

export type EmailProcessMessage = z.infer<typeof emailProcessMessageSchema>;
