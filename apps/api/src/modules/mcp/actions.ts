import type { Db } from "@leren/db";
import type { McpWriteActions, McpWriteOutcome } from "@leren/mcp-server";
import { z } from "zod";

import { autoReplyRuleSchema, emailConditionsSchema } from "../auto-reply-rules/schema";
import type { ReplyConditionsInput } from "../auto-reply-rules/schema";
import { createRule, getRule, updateRule } from "../auto-reply-rules/service";
import { knowledgeItemSchema } from "../knowledge-items/schema";
import { createItem, getItem, updateItem } from "../knowledge-items/service";
import type { KnowledgeResult } from "../knowledge-items/service";

/**
 * The conditions of each channel that the web form starts from. A rule that the assistant creates
 * has these unless the user chose otherwise.
 */
const CHANNEL_DEFAULTS = {
  email: {
    channel: "email",
    senderMode: "any",
    senderAllowlist: [],
    replyWhenTo: true,
    replyWhenCc: false,
    replyWhenBcc: false,
    requireSoleRecipient: false,
    mentionOverrides: false,
    mentionDetection: "alias",
    mentionAliases: [],
    threadMode: "both",
    skipBulkMail: true,
  },
} as const satisfies Record<ReplyConditionsInput["channel"], ReplyConditionsInput>;

const instant = z.iso.datetime({ offset: true });

const ruleFields = z.object({
  name: z.string().describe("The name of the rule."),
  enabled: z.boolean().optional().describe("Whether the rule is on. Defaults to true."),
  timezone: z.string().describe("An IANA timezone name, such as Asia/Jakarta."),
  startsAt: instant.nullable().optional().describe("When the rule starts, or null for no start."),
  endsAt: instant.nullable().optional().describe("When the rule ends, or null for no end."),
  conditions: z
    .array(emailConditionsSchema.partial().required({ channel: true }))
    .optional()
    .describe(
      "The reply conditions for each channel, such as who may be answered. Name the channel in each entry. Anything left out keeps its current or default value, and a channel that is not named is unchanged.",
    ),
});

const knowledgeFields = z.object({
  topic: z.string().describe("The subject of the item, up to 200 characters."),
  response: z.string().describe("What may be said about the subject, up to 5000 characters."),
  examples: z.array(z.string()).optional().describe("Sample incoming messages."),
  restrictions: z.string().optional().describe("What must not be said."),
  contacts: z.array(z.string()).optional().describe("Email addresses or handles to point to."),
  validFrom: instant.nullable().optional().describe("When the item becomes valid."),
  validUntil: instant.nullable().optional().describe("When the item stops being valid."),
});

const createRuleArgs = ruleFields;
const updateRuleArgs = ruleFields.partial().extend({ ruleId: z.uuid() });
const createKnowledgeArgs = knowledgeFields.extend({ ruleId: z.uuid() });
const updateKnowledgeArgs = knowledgeFields.partial().extend({ itemId: z.uuid() });

type ConditionsPatch = Partial<ReplyConditionsInput> & { channel: ReplyConditionsInput["channel"] };

const NOTHING_TO_CHANGE: McpWriteOutcome = {
  status: "invalid",
  message: "Name at least one field to change",
};

/**
 * Drops the keys whose value is `undefined`, so that a default or a stored value is not
 * overwritten by a field that the caller left out.
 */
function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Applies the conditions that the caller names on top of `base`. A named channel starts from its
 * entry in `base`, or from the defaults of the channel when `base` has none, and the channels that
 * are not named stay as they are.
 */
function mergeConditions(
  base: readonly ReplyConditionsInput[],
  patches: readonly ConditionsPatch[],
): ReplyConditionsInput[] {
  const merged = new Map(base.map((entry) => [entry.channel, entry]));

  for (const patch of patches) {
    const current = merged.get(patch.channel) ?? CHANNEL_DEFAULTS[patch.channel];

    merged.set(patch.channel, { ...current, ...definedOnly(patch) } as ReplyConditionsInput);
  }

  return [...merged.values()];
}

function invalid(error: z.ZodError): McpWriteOutcome {
  const message = error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");

  return { status: "invalid", message };
}

/**
 * Converts the result of creating or replacing an item. Those two operations never report a status
 * conflict, which only the approval actions do.
 */
function fromKnowledgeResult(result: KnowledgeResult): McpWriteOutcome {
  switch (result.status) {
    case "saved":
      return { status: "saved", id: result.item.id, data: result.item };
    case "invalid":
      return { status: "invalid", message: Object.values(result.fieldErrors).flat().join("; ") };
    default:
      return { status: "not_found" };
  }
}

/**
 * Builds the tools that let the Assistant Agent create and change rules and knowledge on behalf of
 * the session's user.
 *
 * Each tool validates the complete result with the same schema as the web API and calls the same
 * service, so a rule or item saved here is the same as one saved in the interface. A knowledge item
 * is saved as a draft, or returned to draft when it was approved, because only the user approves
 * knowledge. `requestIndex` asks for the vector index of a written item to be updated, as the web
 * API does.
 */
export function createMcpWriteActions(
  db: Db,
  requestIndex: (itemId: string) => Promise<void>,
): McpWriteActions {
  return {
    createRule: {
      description:
        "Create an auto-reply rule for the user. Call it only after the user has confirmed the details.",
      inputSchema: createRuleArgs,
      async run(userId, input: z.infer<typeof createRuleArgs>) {
        const { conditions, ...fields } = input;

        const parsed = autoReplyRuleSchema.safeParse({
          enabled: true,
          startsAt: null,
          endsAt: null,
          ...definedOnly(fields),
          conditions: mergeConditions([], conditions ?? [{ channel: "email" }]),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const rule = await createRule(db, userId, parsed.data);

        return { status: "saved", id: rule.id, data: rule };
      },
    },
    updateRule: {
      description:
        "Change an existing rule of the user. Name only the fields to change. Call it only after the user has confirmed the change.",
      inputSchema: updateRuleArgs,
      async run(userId, input: z.infer<typeof updateRuleArgs>) {
        const { ruleId, ...changes } = input;

        if (Object.keys(definedOnly(changes)).length === 0) {
          return NOTHING_TO_CHANGE;
        }

        const existing = await getRule(db, userId, ruleId);

        if (!existing) {
          return { status: "not_found" };
        }

        const { conditions, ...fields } = changes;

        const parsed = autoReplyRuleSchema.safeParse({
          name: existing.name,
          enabled: existing.enabled,
          timezone: existing.timezone,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          ...definedOnly(fields),
          conditions: mergeConditions(existing.conditions, conditions ?? []),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const rule = await updateRule(db, userId, ruleId, parsed.data);

        return rule ? { status: "saved", id: rule.id, data: rule } : { status: "not_found" };
      },
    },
    createKnowledge: {
      description:
        "Create a knowledge item for one of the user's rules. It is saved as a draft that the user approves in the interface. Call it only after the user has confirmed the exact text.",
      inputSchema: createKnowledgeArgs,
      async run(userId, input: z.infer<typeof createKnowledgeArgs>) {
        const parsed = knowledgeItemSchema.safeParse({
          examples: [],
          restrictions: "",
          contacts: [],
          validFrom: null,
          validUntil: null,
          ...definedOnly(input),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const result = await createItem(db, userId, parsed.data);

        if (result.status === "saved") {
          await requestIndex(result.item.id);
        }

        return fromKnowledgeResult(result);
      },
    },
    updateKnowledge: {
      description:
        "Change an existing knowledge item of the user. Name only the fields to change. An approved item returns to draft and the user approves it again. Call it only after the user has confirmed the exact text.",
      inputSchema: updateKnowledgeArgs,
      async run(userId, input: z.infer<typeof updateKnowledgeArgs>) {
        const { itemId, ...changes } = input;

        if (Object.keys(definedOnly(changes)).length === 0) {
          return NOTHING_TO_CHANGE;
        }

        const existing = await getItem(db, userId, itemId);

        if (!existing) {
          return { status: "not_found" };
        }

        const parsed = knowledgeItemSchema.safeParse({
          ruleId: existing.ruleId,
          topic: existing.topic,
          response: existing.response,
          examples: existing.examples,
          restrictions: existing.restrictions,
          contacts: existing.contacts,
          validFrom: existing.validFrom,
          validUntil: existing.validUntil,
          ...definedOnly(changes),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const result = await updateItem(db, userId, itemId, parsed.data);

        if (result.status === "saved") {
          await requestIndex(result.item.id);
        }

        return fromKnowledgeResult(result);
      },
    },
  };
}
