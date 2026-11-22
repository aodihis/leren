import { z } from "zod";

export const mcpSessionParamsSchema = z.object({ id: z.uuid() });
