import { z } from "zod";

/**
 * The body of a request that creates or replaces a contact. The address is stored in lower case so
 * that uniqueness within a user does not depend on case.
 */
export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
  role: z.string().trim().max(100),
});

export const contactParamsSchema = z.object({ id: z.uuid() });

export type ContactInput = z.infer<typeof contactSchema>;
