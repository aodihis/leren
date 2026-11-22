import type { Db } from "@leren/db";
import type { McpWriteActions, McpWriteOutcome } from "@leren/mcp-server";
import { z } from "zod";

import { NOTHING_TO_CHANGE, definedOnly, invalid } from "../../mcp-write";
import { emailConditionsSchema, playbookSchema } from "./schema";
import type { ReplyConditionsInput } from "./schema";
import { createPlaybook, getPlaybook, updatePlaybook } from "./service";

/**
 * The conditions of each channel that the web form starts from. A playbook that the assistant
 * creates has these unless the user chose otherwise.
 */
const CHANNEL_DEFAULTS = {
  email: {
    channel: "email",
    replyMode: "draft",
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

const playbookFields = z.object({
  enabled: z.boolean().optional().describe("Whether the playbook is on. Defaults to true."),
  topic: z.string().describe("The subject of the playbook, up to 200 characters."),
  response: z.string().describe("What may be said about the subject, up to 5000 characters."),
  timezone: z.string().describe("An IANA timezone name, such as Asia/Jakarta."),
  examples: z.array(z.string()).optional().describe("Sample incoming messages."),
  restrictions: z.string().optional().describe("What must not be said."),
  contacts: z.array(z.string()).optional().describe("Email addresses or handles to point to."),
  startsAt: instant.nullable().optional().describe("When the playbook starts, or null for none."),
  endsAt: instant.nullable().optional().describe("When the playbook ends, or null for none."),
  conditions: z
    .array(
      emailConditionsSchema
        .omit({ channelAccountId: true, replyMode: true })
        .partial()
        .required({ channel: true }),
    )
    .optional()
    .describe(
      "The reply conditions for each channel, such as who may be answered. Name the channel in each entry. Anything left out keeps its current or default value, and a channel that is not named is unchanged.",
    ),
});

const createPlaybookArgs = playbookFields;
const updatePlaybookArgs = playbookFields.partial().extend({ playbookId: z.uuid() });

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
 * Converts the result of replacing a playbook.
 */
function fromUpdate(result: Awaited<ReturnType<typeof updatePlaybook>>): McpWriteOutcome {
  return result.status === "saved"
    ? { status: "saved", id: result.playbook.id, data: result.playbook }
    : { status: "not_found" };
}

/**
 * Builds the tools that let the Assistant Agent create and change playbooks on behalf of the
 * session's user. Each tool validates the complete result with the same schema as the web API and
 * calls the same service, so a playbook saved here is the same as one saved in the interface. The
 * assistant asks for the user's confirmation in the conversation before it calls a write tool, and
 * nothing in code enforces that (decision 0036). `requestIndex` asks for the vector index of a
 * written playbook to be updated, as the web API does.
 */
export function createPlaybookMcpActions(
  db: Db,
  requestIndex: (playbookId: string) => Promise<void>,
): Pick<McpWriteActions, "createPlaybook" | "updatePlaybook"> {
  return {
    createPlaybook: {
      description:
        "Create a playbook for the user. Call it only after the user has confirmed the exact content.",
      inputSchema: createPlaybookArgs,
      async run(userId, input: z.infer<typeof createPlaybookArgs>) {
        const { conditions, ...fields } = input;

        const parsed = playbookSchema.safeParse({
          enabled: true,
          examples: [],
          restrictions: "",
          contacts: [],
          startsAt: null,
          endsAt: null,
          ...definedOnly(fields),
          conditions: mergeConditions([], conditions ?? [{ channel: "email" }]),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const playbook = await createPlaybook(db, userId, parsed.data);

        await requestIndex(playbook.id);

        return { status: "saved", id: playbook.id, data: playbook };
      },
    },
    updatePlaybook: {
      description:
        "Change an existing playbook of the user. Name only the fields to change. Call it only after the user has confirmed the exact content.",
      inputSchema: updatePlaybookArgs,
      async run(userId, input: z.infer<typeof updatePlaybookArgs>) {
        const { playbookId, ...changes } = input;

        if (Object.keys(definedOnly(changes)).length === 0) {
          return NOTHING_TO_CHANGE;
        }

        const existing = await getPlaybook(db, userId, playbookId);

        if (!existing) {
          return { status: "not_found" };
        }

        const { conditions, ...fields } = changes;

        const parsed = playbookSchema.safeParse({
          enabled: existing.enabled,
          topic: existing.topic,
          response: existing.response,
          examples: existing.examples,
          restrictions: existing.restrictions,
          contacts: existing.contacts,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          timezone: existing.timezone,
          ...definedOnly(fields),
          conditions: mergeConditions(existing.conditions, conditions ?? []),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const result = await updatePlaybook(db, userId, playbookId, parsed.data);

        if (result.status === "saved") {
          await requestIndex(result.playbook.id);
        }

        return fromUpdate(result);
      },
    },
  };
}
