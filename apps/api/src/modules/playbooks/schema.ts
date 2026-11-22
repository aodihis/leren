import { z } from "zod";

const MAX_LIST_ITEMS = 100;
const MAX_EXAMPLES = 50;
const MAX_CONTACTS = 20;
const SENDER_ENTRY_PATTERN = /^(@[^@\s]+\.[^@\s]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/;
const CONTACT_PATTERN = /^([^\s,@]+@[^\s,@]+\.[^\s,@]+|@?[\w.-]+)$/;

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
 * entries. `channelAccountId` names the channel account that the playbook listens on, and null or
 * absent means none. The service rejects an account that does not belong to the playbook's owner
 * or is on another channel (decision 0038). `replyMode` says what happens to a reply: `draft` saves
 * it for the user to approve and `send` sends it without approval. A request that leaves it out
 * gets `draft` (decision 0039).
 */
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
 * The body of a request that creates or replaces a playbook. The bounds are ISO 8601 instants with
 * an offset, and a null bound is open. A playbook that ends before it starts is rejected.
 * `conditions` holds one entry for each channel that the playbook listens on. A disabled playbook
 * is never used.
 */
export const playbookSchema = z
  .object({
    enabled: z.boolean(),
    topic: z.string().trim().min(1, "Enter a topic").max(200),
    examples: z.array(z.string().trim().min(1).max(500)).max(MAX_EXAMPLES),
    response: z.string().trim().min(1, "Enter a response").max(5000),
    restrictions: z.string().trim().max(2000),
    contacts: z
      .array(z.string().trim().regex(CONTACT_PATTERN, "Enter an email address or a handle"))
      .max(MAX_CONTACTS),
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

/**
 * The filters of the list route. `enabled` keeps only the enabled or only the disabled playbooks,
 * and `usable=true` keeps only the playbooks that the assistant may use now.
 */
export const playbookListQuerySchema = z.object({
  enabled: z.enum(["true", "false"]).optional(),
  usable: z.enum(["true"]).optional(),
});

export type PlaybookInput = z.infer<typeof playbookSchema>;

export type PlaybookListQuery = z.infer<typeof playbookListQuerySchema>;
