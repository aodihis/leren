import { playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

/** How a reply is delivered (decision 0046). */
export type DeliveryMode = "draft" | "send";

const isPlaybookId = (id: string) => z.uuid().safeParse(id).success;

const replyModeSchema = z.object({ replyMode: z.enum(["draft", "send"]) });

/**
 * Chooses how a reply is delivered, from the reply mode of the playbooks that the run used, for the
 * channel account that the message arrived on (decision 0046). The reply is sent without approval
 * only when every one of those playbooks is in `send` mode. A playbook that is in `draft` mode, that
 * no longer exists, is disabled, or whose conditions do not name the account makes the reply a
 * draft, and so does a run that used no playbook, an id that is not the id of a playbook, and a
 * message whose account was deleted. The mode is read when the pipeline ends, so a change of mode
 * applies to the replies that are made after it.
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
