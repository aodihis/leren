import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name"),
  lastName: z.string().trim().min(1, "Enter your last name"),
  replyInstruction: z.string().trim().max(2000, "Use at most 2000 characters").optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
