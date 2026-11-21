import { z } from "zod";

const MAX_LIST_ITEMS = 100;
const SENDER_ENTRY_PATTERN = /^(@[^@\s]+\.[^@\s]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

/**
 * Reports whether `timezone` is an IANA zone name that the runtime knows.
 */
function isTimezone(timezone: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: timezone }).resolvedOptions().timeZone !== ""
    );
  } catch {
    return false;
  }
}

/**
 * The conditions of the `email` channel. A sender allowlist holds full addresses and `@domain`
 * entries.
 */
export const emailConditionsSchema = z.object({
  channel: z.literal("email"),
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

/**
 * The reply conditions of one channel. Only the channels in this union are accepted, so a request
 * for any other channel is rejected. A channel added later is a new member of this union, with its
 * own settings, and needs no change to the tables.
 */
export const replyConditionsSchema = z.discriminatedUnion("channel", [emailConditionsSchema], {
  error: "Only the email channel is supported",
});

export type ReplyConditionsInput = z.infer<typeof replyConditionsSchema>;

/**
 * The body of a request that creates or replaces an auto-reply rule. The bounds are ISO 8601
 * instants with an offset, and a null bound is open. A rule that ends before it starts is rejected.
 * `conditions` holds one entry for each channel that the rule listens on.
 */
export const autoReplyRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(100),
    enabled: z.boolean(),
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    timezone: z.string().refine(isTimezone, "Choose a valid timezone"),
    conditions: z.array(replyConditionsSchema).min(1, "Choose at least one channel"),
  })
  .refine(
    (rule) =>
      new Set(rule.conditions.map((entry) => entry.channel)).size === rule.conditions.length,
    { path: ["conditions"], message: "Give each channel only once" },
  )
  .refine(
    (rule) => !rule.startsAt || !rule.endsAt || new Date(rule.startsAt) <= new Date(rule.endsAt),
    { path: ["endsAt"], message: "The end must not be before the start" },
  );

export const ruleParamsSchema = z.object({ id: z.uuid() });

export type AutoReplyRuleInput = z.infer<typeof autoReplyRuleSchema>;
