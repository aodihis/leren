import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";

/** Maps each invalid field of a failed validation to its messages, as the `400` body. */
function toFieldErrorsBody(error: z.core.$ZodError): {
  fieldErrors: Record<string, string[] | undefined>;
} {
  return { fieldErrors: z.flattenError(error).fieldErrors };
}

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
      return c.json(toFieldErrorsBody(result.error), 400);
    }
  });
}

/** The body of a `400` answer for a rejected request. */
export const fieldErrorsSchema = z.object({
  fieldErrors: z.record(z.string(), z.array(z.string()).optional()),
});

/** The body of an error answer, such as `401` or `404`. */
export const errorSchema = z.object({ error: z.string() });

/**
 * The hook that `OpenAPIHono` runs after request validation. A failure responds with `400` and
 * `{ fieldErrors }`, exactly as `validate` does, so documented routes and the other routes answer
 * an invalid request in one shape.
 */
export function validationHook(
  result: { success: boolean; error?: z.ZodError },
  c: { json: (body: unknown, status: 400) => Response },
): Response | undefined {
  if (!result.success && result.error) {
    return c.json(toFieldErrorsBody(result.error), 400);
  }

  return undefined;
}
