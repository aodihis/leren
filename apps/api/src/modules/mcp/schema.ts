import { z } from "zod";

export const mcpSessionParamsSchema = z.object({ id: z.uuid() });

/** The lifetimes that a user can choose for an access token, in days. */
export const ACCESS_TOKEN_LIFETIMES_DAYS = [30, 90, 365] as const;

/** `read` grants the read scopes of the assistant role, and `write` grants all of them. */
export const ACCESS_TOKEN_ACCESS_LEVELS = ["read", "write"] as const;

export const createAccessTokenSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters"),
  access: z.enum(ACCESS_TOKEN_ACCESS_LEVELS),
  expiresInDays: z.union(ACCESS_TOKEN_LIFETIMES_DAYS.map((days) => z.literal(days))),
});

export type CreateAccessTokenInput = z.infer<typeof createAccessTokenSchema>;
