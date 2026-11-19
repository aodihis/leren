/**
 * Thrown by a handler to dead-letter its message at once, because another attempt cannot succeed.
 * An invalid payload is the typical case.
 */
export class NonRetryableError extends Error {
  override name = "NonRetryableError";
}

/** Returns the text recorded as `lastError` for a failed attempt. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
