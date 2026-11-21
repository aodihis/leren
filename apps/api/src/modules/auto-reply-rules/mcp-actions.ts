import type { Db } from "@leren/db";
import type { McpWriteActions } from "@leren/mcp-server";
import { z } from "zod";

import { NOTHING_TO_CHANGE, definedOnly, invalid } from "../../mcp-write";
import { autoReplyRuleSchema, emailConditionsSchema } from "./schema";
import type { ReplyConditionsInput } from "./schema";
import { createRule, getRule, updateRule } from "./service";

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

const createRuleArgs = ruleFields;
const updateRuleArgs = ruleFields.partial().extend({ ruleId: z.uuid() });

type ConditionsPatch = Partial<ReplyConditionsInput> & { channel: ReplyConditionsInput["channel"] };

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

/**
 * Builds the tools that let the Assistant Agent create and change rules on behalf of the session's
 * user. Each tool validates the complete result with the same schema as the web API and calls the
 * same service, so a rule saved here is the same as one saved in the interface.
 */
export function createRuleMcpActions(db: Db): Pick<McpWriteActions, "createRule" | "updateRule"> {
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
  };
}
