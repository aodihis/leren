import { z } from "zod";

const MAX_LIST_ITEMS = 100;
const MAX_EXAMPLES = 50;
const SENDER_ENTRY_PATTERN = /^(@[^@\s]+\.[^@\s]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

/** Reports whether a timezone is a known IANA zone. */
function isTimezone(timezone: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone !== ""
    );
  } catch {
    return false;
  }
}

/** The conditions of the email channel. */
export const emailConditionsSchema = z.object({
  channel: z.literal("email"),
  channelAccountId: z.uuid().nullable().optional(),
  replyMode: z.enum(["draft", "send"]).default("draft"),
  senderMode: z.enum(["any", "allowlist"]),
  senderAllowlist: z
    .array(
      z.string().trim().toLowerCase().regex(SENDER_ENTRY_PATTERN, "Enter an address or @domain"),
    )
    .max(MAX_LIST_ITEMS),
  replyWhenTo: z.boolean(),
  replyWhenCc: z.boolean(),
  replyWhenBcc: z.boolean(),
  requireSoleRecipient: z.boolean(),
  mentionOverrides: z.boolean(),
  mentionDetection: z.enum(["alias", "alias_then_llm"]),
  mentionAliases: z.array(z.string().trim().min(1).max(100)).max(MAX_LIST_ITEMS),
  threadMode: z.enum(["new", "reply", "both"]),
  skipBulkMail: z.boolean(),
});

/** The reply conditions of one channel. */
export const replyConditionsSchema = z.discriminatedUnion("channel", [emailConditionsSchema], {
  error: "Only the email channel is supported",
});

export type ReplyConditionsInput = z.infer<typeof replyConditionsSchema>;

/** The body that creates or replaces a playbook. */
export const playbookSchema = z
  .object({
    enabled: z.boolean(),
    topic: z.string().trim().min(1, "Enter a topic").max(200),
    examples: z.array(z.string().trim().min(1).max(500)).max(MAX_EXAMPLES),
    response: z.string().trim().min(1, "Enter a response").max(5000),
    restrictions: z.string().trim().max(2000),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    timezone: z.string().refine(isTimezone, "Choose a valid timezone"),
    conditions: z.array(replyConditionsSchema).min(1, "Choose at least one channel"),
  })
  .refine(
    (playbook) =>
      new Set(playbook.conditions.map((entry) => entry.channel)).size ===
      playbook.conditions.length,
    { path: ["conditions"], message: "Give each channel only once" },
  )
  .refine(
    (playbook) =>
      !playbook.startsAt ||
      !playbook.endsAt ||
      new Date(playbook.startsAt) <= new Date(playbook.endsAt),
    { path: ["endsAt"], message: "The end must not be before the start" },
  );

export const playbookParamsSchema = z.object({ id: z.uuid() });

export const playbookEnabledSchema = z.object({ enabled: z.boolean() });

/** The filters of the playbook list route. */
export const playbookListQuerySchema = z.object({
  enabled: z.enum(["true", "false"]).optional(),
  usable: z.enum(["true"]).optional(),
});

export type PlaybookInput = z.infer<typeof playbookSchema>;

export type PlaybookListQuery = z.infer<typeof playbookListQuerySchema>;
