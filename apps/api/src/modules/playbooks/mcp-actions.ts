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
 * Tells the assistant why no account could be chosen for a playbook that is on (decision 0044): the
 * user has none, or has several and must say which one.
 */
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

/**
 * Names the account for every entry that has none, when the playbook is on. An entry takes the
 * only active account that the user has on its channel. An entry that names an account that is not
 * active, such as one that was revoked after the playbook was saved, is not replaced silently: the
 * result is the message that lists the active accounts. The same message tells the assistant what to
 * do when the user has none or has several. A playbook that is off keeps its entries as they are.
 */
async function resolveAccounts(
  db: Db,
  userId: string,
  conditions: readonly ReplyConditionsInput[],
  enabled: boolean,
): Promise<{ conditions: ReplyConditionsInput[] } | { message: string }> {
  const resolved: ReplyConditionsInput[] = [];

  for (const entry of conditions) {
    if (!enabled) {
      resolved.push(entry);
      continue;
    }

    const accounts = await listActiveAccounts(db, userId, entry.channel);

    if (entry.channelAccountId) {
      if (!accounts.some((account) => account.id === entry.channelAccountId)) {
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

/**
 * Converts the error of a write whose account was rejected into the outcome that the assistant
 * reads, or returns `undefined` for any other error, which the caller throws again.
 */
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
          contacts: [],
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
          contacts: existing.contacts,
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
