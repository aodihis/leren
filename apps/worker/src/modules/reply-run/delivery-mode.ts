import { playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

/** How a reply is delivered (decision 0046). */
export type DeliveryMode = "draft" | "send";

const isPlaybookId = (id: string) => z.uuid().safeParse(id).success;

const replyModeSchema = z.object({ replyMode: z.enum(["draft", "send"]) });

/**
 * Chooses how a reply is delivered from the reply modes of the playbooks the run used, for the
 * receiving account (decision 0046). The reply is sent only when every such playbook still exists,
 * is enabled, names the account and is in `send` mode. Otherwise it is a draft.
 */
export async function chooseDeliveryMode(
  db: Db,
  record: { channel: string; channelAccountId: string | null },
  playbookIds: readonly string[],
): Promise<DeliveryMode> {
  if (playbookIds.length === 0 || !playbookIds.every(isPlaybookId) || !record.channelAccountId) {
    return "draft";
  }

  const rows = await db
    .select({ playbookId: replyConditions.playbookId, settings: replyConditions.settings })
    .from(replyConditions)
    .innerJoin(playbooks, eq(playbooks.id, replyConditions.playbookId))
    .where(
      and(
        eq(playbooks.enabled, true),
        inArray(replyConditions.playbookId, [...playbookIds]),
        eq(replyConditions.channel, record.channel),
        eq(replyConditions.channelAccountId, record.channelAccountId),
      ),
    );

  const modes = new Map(
    rows.map((row) => [row.playbookId, replyModeSchema.safeParse(row.settings).data?.replyMode]),
  );

  return playbookIds.every((id) => modes.get(id) === "send") ? "send" : "draft";
}
