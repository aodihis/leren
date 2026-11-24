import { z } from "zod";

/** The message of email.deliver. */
export const emailDeliverMessageSchema = z.object({ messageId: z.uuid() });

export type EmailDeliverMessage = z.infer<typeof emailDeliverMessageSchema>;
