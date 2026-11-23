import { z } from "zod";

const MAX_DAYS = 365;

/** The window of the overview: the last `days` days, counted back from the time of the request. */
export const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_DAYS).default(30),
});

export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export const reportParamsSchema = z.object({ id: z.uuid() });
