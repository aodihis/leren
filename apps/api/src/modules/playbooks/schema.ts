import { z } from "zod";

import type { PlaybookView } from "./service";

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
 * entries. `channelAccountId` names the channel account that the playbook listens on, and null or
 * absent means none. A playbook that is enabled must name one, and a new or newly enabled playbook
 * must name an active one (decision 0044). The schema cannot check this, because it depends on the
 * stored state of the playbook and of the account, so the service enforces it for the web routes and
 * the assistant tools alike. The service also rejects an account that does not belong to the
 * playbook's owner or is on another channel (decision 0038). `replyMode` says what happens to a reply: `draft` saves
 * it for the user to approve and `send` sends it without approval. A request that leaves it out
 * gets `draft` (decision 0039).
 */
export const emailConditionsSchema = z.object({
  channel: z.literal("email").describe("The channel that these conditions are for."),
  channelAccountId: z.uuid().nullable().optional(),
  replyMode: z.enum(["draft", "send"]).default("draft"),
  senderMode: z
    .enum(["any", "allowlist"])
    .describe("Who may be answered: `any` sender, or only the senders in `senderAllowlist`."),
  senderAllowlist: z
    .array(
      z.string().trim().toLowerCase().regex(SENDER_ENTRY_PATTERN, "Enter an address or @domain"),
    )
    .max(MAX_LIST_ITEMS)
    .describe(
      "Full addresses or `@domain` entries. It is used only when `senderMode` is `allowlist`.",
    ),
  replyWhenTo: z.boolean().describe("Reply when the message is addressed to the user in To."),
  replyWhenCc: z.boolean().describe("Reply when the user was copied in Cc."),
  replyWhenBcc: z
    .boolean()
    .describe("Reply when the user's address is in neither To nor Cc, so the user was in Bcc."),
  requireSoleRecipient: z
    .boolean()
    .describe("Skip messages in To that are also sent to other people."),
  mentionOverrides: z
    .boolean()
    .describe(
      "Answer a message that names the user even when the user's role or the number of recipients would exclude it.",
    ),
  mentionDetection: z
    .enum(["alias", "alias_then_llm"])
    .describe(
      "How a mention is detected: by the aliases only, or by the aliases first and then by a model.",
    ),
  mentionAliases: z
    .array(z.string().trim().min(1).max(100))
    .max(MAX_LIST_ITEMS)
    .describe("The names that count as a mention of the user."),
  threadMode: z
    .enum(["new", "reply", "both"])
    .describe("Which messages are answered: only new conversations, only replies, or both."),
  skipBulkMail: z
    .boolean()
    .describe("Never reply to newsletters, list mail or messages sent by a machine."),
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
 * is never used. An empty `instruction` means that only the default instruction of the user applies
 * (decision 0051).
 */
export const playbookSchema = z
  .object({
    enabled: z.boolean(),
    topic: z.string().trim().min(1, "Enter a topic").max(200),
    information: z.string().trim().min(1, "Enter the information").max(5000),
    instruction: z.string().trim().max(2000),
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

/**
 * The body of an answer that carries one playbook. The playbook is typed from the service, so the
 * platform infers it through Hono RPC, and it is described in the OpenAPI document as an object.
 */
export const playbookResponseSchema = z.object({
  playbook: z.custom<PlaybookView>().meta({ type: "object", description: "The playbook." }),
});

/** The body of an answer that lists playbooks. */
export const playbookListResponseSchema = z.object({
  playbooks: z.array(z.custom<PlaybookView>().meta({ type: "object" })),
});
