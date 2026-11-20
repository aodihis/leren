import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name"),
  lastName: z.string().trim().min(1, "Enter your last name"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
