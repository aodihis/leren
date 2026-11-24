import type { Db } from "@leren/db";
import type { McpWriteActions, McpWriteOutcome } from "@leren/mcp-server";
import { z } from "zod";

import { NOTHING_TO_CHANGE, definedOnly, invalid } from "../../mcp-write";
import { emailConditionsSchema, playbookSchema } from "./schema";
import type { ReplyConditionsInput } from "./schema";
import {
  ChannelAccountRequiredError,
  ChannelAccountUnavailableError,
  createPlaybook,
  getPlaybook,
  listActiveAccounts,
  updatePlaybook,
} from "./service";
import type { ActiveAccount } from "./service";

/** The default conditions of each channel. */
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
  response: z
    .string()
    .describe(
      "What may be said about the subject, up to 5000 characters. Include whom to contact, if anyone.",
    ),
  timezone: z.string().describe("An IANA timezone name, such as Asia/Jakarta."),
  examples: z.array(z.string()).optional().describe("Sample incoming messages."),
  restrictions: z.string().optional().describe("What must not be said."),
  startsAt: instant.nullable().optional().describe("When the playbook starts, or null for none."),
  endsAt: instant.nullable().optional().describe("When the playbook ends, or null for none."),
  conditions: z
    .array(
      emailConditionsSchema
        .omit({ channelAccountId: true, replyMode: true })
        .extend({
          channelAccountId: z
            .uuid()
            .optional()
            .describe(
              "The id of the connected account that the playbook answers on. Leave it out to use the only account that the user has.",
            ),
        })
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

/** Applies named conditions on top of a base. */
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

/** Explains why no account could be chosen. */
function describeAccountProblem(
  channel: string,
  accounts: readonly ActiveAccount[],
  rejectedId?: string,
): string {
  const rejected = rejectedId
    ? `The account ${rejectedId} is not one of the user's active ${channel} accounts. `
    : "";

  if (accounts.length === 0) {
    return `conditions: ${rejected}The user has no connected ${channel} account. A playbook that is on needs one. Ask the user to connect one on the Channels page, and try again after that.`;
  }

  const choices = accounts.map((account) => `${account.label} (${account.id})`).join(", ");

  return `conditions: ${rejected}The user has ${accounts.length === 1 ? "one" : "several"} ${channel} ${accounts.length === 1 ? "account" : "accounts"}: ${choices}. Ask the user which one the playbook answers on, and pass its id as channelAccountId.`;
}

/** Names the account for each entry that has none. */
async function resolveAccounts(
  db: Db,
  userId: string,
  conditions: readonly ReplyConditionsInput[],
  enabled: boolean,
  kept: ReadonlySet<string> = new Set(),
): Promise<{ conditions: ReplyConditionsInput[] } | { message: string }> {
  const resolved: ReplyConditionsInput[] = [];

  for (const entry of conditions) {
    if (!enabled) {
      resolved.push(entry);
      continue;
    }

    const accounts = await listActiveAccounts(db, userId, entry.channel);

    if (entry.channelAccountId) {
      const active = accounts.some((account) => account.id === entry.channelAccountId);

      if (!active && !kept.has(entry.channelAccountId)) {
        return { message: describeAccountProblem(entry.channel, accounts, entry.channelAccountId) };
      }

      resolved.push(entry);
      continue;
    }

    const [only] = accounts;

    if (accounts.length !== 1 || !only) {
      return { message: describeAccountProblem(entry.channel, accounts) };
    }

    resolved.push({ ...entry, channelAccountId: only.id });
  }

  return { conditions: resolved };
}

/** Converts an account rejection into a tool outcome. */
function describeAccountError(error: unknown): McpWriteOutcome | undefined {
  if (error instanceof ChannelAccountRequiredError) {
    return invalidMessage("conditions: A playbook that is on must name a connected account");
  }

  if (error instanceof ChannelAccountUnavailableError) {
    return invalidMessage(
      "conditions: channelAccountId is not one of the user's active accounts. Use the id of a connected account.",
    );
  }

  return undefined;
}

function invalidMessage(message: string): McpWriteOutcome {
  return { status: "invalid", message };
}

/**
 * Converts the result of replacing a playbook.
 */
function fromUpdate(result: Awaited<ReturnType<typeof updatePlaybook>>): McpWriteOutcome {
  return result.status === "saved"
    ? { status: "saved", id: result.playbook.id, data: result.playbook }
    : { status: "not_found" };
}

/** Builds the assistant's playbook write tools. */
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

        const accounts = await resolveAccounts(
          db,
          userId,
          mergeConditions([], conditions ?? [{ channel: "email" }]),
          fields.enabled ?? true,
        );

        if ("message" in accounts) {
          return invalidMessage(accounts.message);
        }

        const parsed = playbookSchema.safeParse({
          enabled: true,
          examples: [],
          restrictions: "",
          startsAt: null,
          endsAt: null,
          ...definedOnly(fields),
          conditions: accounts.conditions,
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        try {
          const playbook = await createPlaybook(db, userId, parsed.data);

          await requestIndex(playbook.id);

          return { status: "saved", id: playbook.id, data: playbook };
        } catch (error) {
          const outcome = describeAccountError(error);

          if (!outcome) {
            throw error;
          }

          return outcome;
        }
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

        const accounts = await resolveAccounts(
          db,
          userId,
          mergeConditions(existing.conditions, conditions ?? []),
          fields.enabled ?? existing.enabled,
          fields.enabled === true && !existing.enabled
            ? new Set()
            : new Set(existing.conditions.flatMap((entry) => entry.channelAccountId ?? [])),
        );

        if ("message" in accounts) {
          return invalidMessage(accounts.message);
        }

        const parsed = playbookSchema.safeParse({
          enabled: existing.enabled,
          topic: existing.topic,
          response: existing.response,
          examples: existing.examples,
          restrictions: existing.restrictions,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          timezone: existing.timezone,
          ...definedOnly(fields),
          conditions: accounts.conditions,
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        try {
          const result = await updatePlaybook(db, userId, playbookId, parsed.data);

          if (result.status === "saved") {
            await requestIndex(result.playbook.id);
          }

          return fromUpdate(result);
        } catch (error) {
          const outcome = describeAccountError(error);

          if (!outcome) {
            throw error;
          }

          return outcome;
        }
      },
    },
  };
}
