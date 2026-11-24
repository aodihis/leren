import { z } from "zod";

/** The payload of email.received. */
export const emailGatePayloadSchema = z.object({ messageId: z.uuid() });

export type EmailGatePayload = z.infer<typeof emailGatePayloadSchema>;

/** The email settings of a playbook as stored. */
export const emailSettingsSchema = z.object({
  senderMode: z.enum(["any", "allowlist"]),
  senderAllowlist: z.array(z.string()),
  replyWhenTo: z.boolean(),
  replyWhenCc: z.boolean(),
  replyWhenBcc: z.boolean(),
  requireSoleRecipient: z.boolean(),
  mentionOverrides: z.boolean(),
  mentionDetection: z.enum(["alias", "alias_then_llm"]),
  mentionAliases: z.array(z.string()),
  threadMode: z.enum(["new", "reply", "both"]),
  skipBulkMail: z.boolean(),
});
