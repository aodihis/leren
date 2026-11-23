import { messages, replyDecisions } from "@leren/db";
import type { Db } from "@leren/db";
import { transitionMessage } from "@leren/inbox";
import type { EmailDeliverMessage, EmailProcessMessage, MessageStatus } from "@leren/inbox";
import type { PipelineInput, ReplyResult } from "@leren/reply-agent";
import { eq } from "drizzle-orm";

import { closeReplySession, openReplySession } from "../reply-session/service";
import type { ReplySessionDependencies } from "../reply-session/service";
import { chooseDeliveryMode } from "./delivery-mode";

/** What the pipeline needs to run for one message. */
export type PipelineRun = {
  input: PipelineInput;
  /** The playbooks that the gate named for the message. No other playbook may be used. */
  allowedPlaybookIds: ReadonlySet<string>;
  /** The token of the MCP session of this run. */
  token: string;
  signal: AbortSignal;
};

/** Runs the reply pipeline for one message and returns its result. */
export type PipelineRunner = (run: PipelineRun) => Promise<ReplyResult>;

export type ReplyRunDependencies = {
  db: Db;
  sessions: ReplySessionDependencies;
  runPipeline: PipelineRunner;
  /** Publishes a reply that is ready to `email.deliver`, with the message id as its idempotency key. */
  publishDeliver: (message: EmailDeliverMessage) => Promise<void>;
};

/**
 * What the run did. `processed` means that the decision is saved and the message has left
 * `processing`. `ignored` means that the record was gone or had already left the pipeline.
 */
export type ReplyRunOutcome = "processed" | "ignored";

/** The reason that is stored when an email that needed a mention check does not address the user. */
export const NOT_ADDRESSED = "not_addressed";

/** The longest reason, in characters, that is copied to the status of a message. */
const STATUS_REASON_LENGTH = 200;

type Destination = { status: MessageStatus; reason: string | null };

/**
 * The status that a result moves the message to. A reply, for an answer or a delegation, waits as a
 * draft. A message that the pipeline hands back is escalated, and one that is not for the user is
 * not applicable (decision 0043).
 */
function destinationOf(outcome: ReplyResult["outcome"], reasons: readonly string[]): Destination {
  switch (outcome) {
    case "answer":
    case "delegate":
      return { status: "drafted", reason: null };
    case "escalate":
      return { status: "escalated", reason: reasons[0]?.slice(0, STATUS_REASON_LENGTH) ?? null };
    case "ignore":
      return { status: "not_applicable", reason: NOT_ADDRESSED };
  }
}

/** Whether a result is a reply that has to be delivered, as opposed to a message that has none. */
function isReply(outcome: ReplyResult["outcome"]): boolean {
  return outcome === "answer" || outcome === "delegate";
}

/**
 * Saves the result of the pipeline. A message has at most one decision, so saving it twice keeps the
 * first one. A reply is saved with its delivery mode and the delivery state `pending`, so that the
 * decision and the fact that it waits for delivery are written together (decision 0046).
 */
async function saveDecision(
  db: Db,
  record: { id: string; userId: string; channel: string; channelAccountId: string | null },
  result: ReplyResult,
): Promise<void> {
  const playbookIds = result.playbooks.map((playbook) => playbook.id);

  const deliveryMode = isReply(result.outcome)
    ? await chooseDeliveryMode(db, record, playbookIds)
    : null;

  await db
    .insert(replyDecisions)
    .values({
      messageId: record.id,
      userId: record.userId,
      outcome: result.outcome,
      body: result.body ?? null,
      category: result.triage?.category ?? null,
      citations: [...result.citations],
      playbookIds,
      reasons: [...result.reasons],
      revisions: result.revisions,
      evaluations: result.evaluations,
      deliveryMode,
      deliveryState: deliveryMode ? "pending" : null,
    })
    .onConflictDoNothing({ target: replyDecisions.messageId });
}

/**
 * Moves the message to the status that its decision calls for. Returns without a change when the
 * message has already left `processing`.
 */
async function settle(
  db: Db,
  messageId: string,
  outcome: ReplyResult["outcome"],
  reasons: readonly string[],
) {
  const destination = destinationOf(outcome, reasons);

  await transitionMessage(db, messageId, destination.status, destination.reason);
}

/**
 * Publishes `email.deliver` for the decision of a message whose delivery is `pending`. It returns
 * whether it did. The publish is safe to repeat, because the deliverer lets only one delivery move
 * the state from `pending` to `started`, so it is repeated whenever the job finds a reply that was
 * saved but may not have been published (decision 0046).
 */
async function publishPendingDelivery(
  { db, publishDeliver }: ReplyRunDependencies,
  messageId: string,
): Promise<boolean> {
  const [decision] = await db
    .select({ deliveryState: replyDecisions.deliveryState })
    .from(replyDecisions)
    .where(eq(replyDecisions.messageId, messageId));

  if (decision?.deliveryState !== "pending") {
    return false;
  }

  await publishDeliver({ messageId });

  return true;
}

/**
 * Runs the reply pipeline for one message that the gate queued (decision 0043). The function reads
 * the current record and never trusts the job about its state, so a repeated delivery does nothing
 * once the message has left the pipeline, and a delivery after a crash finishes the work: a saved
 * decision is not computed again, the move to the final status is repeated, and a reply that waits
 * for delivery is published again. When the pipeline ends in a reply, the mode of its playbooks
 * decides whether it is delivered as a draft or sent, and `email.deliver` is published.
 *
 * The MCP session of the run is bound to the owner of the record and is revoked when the run ends,
 * whether it succeeded or failed. The mention check is made only when every playbook of the job asks
 * for it.
 */
export async function processMessage(
  dependencies: ReplyRunDependencies,
  payload: EmailProcessMessage,
  signal: AbortSignal,
): Promise<ReplyRunOutcome> {
  const { db, sessions, runPipeline } = dependencies;
  const [record] = await db.select().from(messages).where(eq(messages.id, payload.messageId));

  if (record?.status === "drafted") {
    return (await publishPendingDelivery(dependencies, record.id)) ? "processed" : "ignored";
  }

  if (!record || (record.status !== "queued" && record.status !== "processing")) {
    return "ignored";
  }

  await transitionMessage(db, record.id, "processing");

  const [existing] = await db
    .select()
    .from(replyDecisions)
    .where(eq(replyDecisions.messageId, record.id));

  if (existing) {
    await settle(db, record.id, existing.outcome, existing.reasons);
    await publishPendingDelivery(dependencies, record.id);

    return "processed";
  }

  const session = await openReplySession(sessions, payload);

  try {
    const result = await runPipeline({
      input: {
        messageId: record.id,
        email: { from: record.fromAddress, subject: record.subject, body: record.body },
        checkMention: payload.playbooks.every((entry) => entry.verdict === "check_mention"),
      },
      allowedPlaybookIds: new Set(payload.playbooks.map((entry) => entry.playbookId)),
      token: session.token,
      signal,
    });

    await saveDecision(db, record, result);
    await settle(db, record.id, result.outcome, result.reasons);
    await publishPendingDelivery(dependencies, record.id);
  } finally {
    await closeReplySession(sessions, record.userId, session);
  }

  return "processed";
}
