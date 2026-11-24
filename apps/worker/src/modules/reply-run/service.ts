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
  /** The playbooks that the gate named for the message. */
  allowedPlaybookIds: ReadonlySet<string>;
  /** The token of the MCP session of this run. */
  token: string;
  signal: AbortSignal;
};

/** Runs the reply pipeline for one message. */
export type PipelineRunner = (run: PipelineRun) => Promise<ReplyResult>;

export type ReplyRunDependencies = {
  db: Db;
  sessions: ReplySessionDependencies;
  runPipeline: PipelineRunner;
  /** Publishes a ready reply to email.deliver. */
  publishDeliver: (message: EmailDeliverMessage) => Promise<void>;
};

/** The outcome of a reply run. */
export type ReplyRunOutcome = "processed" | "ignored";

/** The reason stored for a mention check that fails. */
export const NOT_ADDRESSED = "not_addressed";

/** The longest status reason, in characters. */
const STATUS_REASON_LENGTH = 200;

type Destination = { status: MessageStatus; reason: string | null };

/** The status that a result moves a message to. */
function destinationOf(outcome: ReplyResult["outcome"], reasons: readonly string[]): Destination {
  switch (outcome) {
    case "answer":
      return { status: "drafted", reason: null };
    case "escalate":
      return { status: "escalated", reason: reasons[0]?.slice(0, STATUS_REASON_LENGTH) ?? null };
    case "ignore":
      return { status: "not_applicable", reason: NOT_ADDRESSED };
  }
}

/** Whether a result is a reply to deliver. */
function isReply(outcome: ReplyResult["outcome"]): boolean {
  return outcome === "answer";
}

/** Saves the result of the pipeline. */
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

/** Moves the message to the status of its decision. */
async function settle(
  db: Db,
  messageId: string,
  outcome: ReplyResult["outcome"],
  reasons: readonly string[],
) {
  const destination = destinationOf(outcome, reasons);

  await transitionMessage(db, messageId, destination.status, destination.reason);
}

/** Publishes email.deliver for a pending delivery. */
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

/** Runs the reply pipeline for a queued message. */
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
