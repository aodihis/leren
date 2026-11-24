/** Thrown to dead-letter a message at once. */
export class NonRetryableError extends Error {
  override name = "NonRetryableError";
}

/** Returns the text recorded as lastError. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
