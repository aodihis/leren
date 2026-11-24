import { z } from "zod";

const MAX_DAYS = 365;

/** The time window of the overview. */
export const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_DAYS).default(30),
});

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const reportParamsSchema = z.object({ id: z.uuid() });
