import { z } from "zod";

const MESSAGE_STATUSES = [
  "received",
  "not_applicable",
  "queued",
  "processing",
  "drafted",
  "sent",
  "escalated",
  "failed",
] as const;

const MESSAGE_OUTCOMES = ["answer", "escalate", "ignore"] as const;

const MAX_PAGE_SIZE = 100;
const MAX_RECIPIENTS = 50;
const ADDRESS = z.string().trim().toLowerCase().min(3).max(320);

export type Cursor = { receivedAt: Date; id: string };

/** Encodes a position as an opaque cursor. */
export function encodeCursor({ receivedAt, id }: Cursor): string {
  return Buffer.from(`${receivedAt.toISOString()}|${id}`).toString("base64url");
}

/** Decodes a cursor, or returns null. */
export function decodeCursor(value: string): Cursor | null {
  const [instant, id, ...rest] = Buffer.from(value, "base64url").toString().split("|");
  const receivedAt = new Date(instant ?? "");

  if (
    rest.length > 0 ||
    !id ||
    Number.isNaN(receivedAt.getTime()) ||
    !z.uuid().safeParse(id).success
  ) {
    return null;
  }

  return { receivedAt, id };
}

/** The filters and page of the list route. */
export const messageListQuerySchema = z.object({
  status: z.enum(MESSAGE_STATUSES).optional(),
  outcome: z.enum(MESSAGE_OUTCOMES).optional(),
  failed: z.literal("true").optional(),
  since: z.iso.datetime().pipe(z.coerce.date()).optional(),
  channel: z.string().min(1).max(50).optional(),
  channelAccountId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  cursor: z
    .string()
    .max(200)
    .transform((value, context) => {
      const cursor = decodeCursor(value);

      if (!cursor) {
        context.addIssue({ code: "custom", message: "Invalid cursor" });

        return z.NEVER;
      }

      return cursor;
    })
    .optional(),
});

export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export const messageParamsSchema = z.object({ id: z.uuid() });

/** The body that records a simulated email. */
export const simulateEmailSchema = z.object({
  from: ADDRESS,
  to: z.array(ADDRESS).max(MAX_RECIPIENTS).optional(),
  cc: z.array(ADDRESS).max(MAX_RECIPIENTS).default([]),
  subject: z.string().max(1000).default(""),
  body: z.string().max(200_000),
  isReply: z.boolean().default(false),
  isBulk: z.boolean().default(false),
  providerMessageId: z.string().min(1).max(200).optional(),
  providerThreadId: z.string().min(1).max(200).nullable().optional(),
});

export type SimulateEmailInput = z.infer<typeof simulateEmailSchema>;
