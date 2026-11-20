import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";

/**
 * Validates a request target with a zod schema. A failure responds with `400` and
 * `{ fieldErrors }`, which maps each invalid field to its messages. The response type is part of
 * the API's Hono RPC types, so clients can show the messages next to their fields.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const fieldErrors: Record<string, string[] | undefined> = z.flattenError(
        result.error,
      ).fieldErrors;

      return c.json({ fieldErrors }, 400);
    }
  });
}
