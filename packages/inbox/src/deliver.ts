import { z } from "zod";

/** The message of `email.deliver`: the record whose reply is ready to be delivered (decision 0046). */
export const emailDeliverMessageSchema = z.object({ messageId: z.uuid() });

export type EmailDeliverMessage = z.infer<typeof emailDeliverMessageSchema>;
