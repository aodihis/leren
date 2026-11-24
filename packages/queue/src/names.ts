/** Returns the dead-letter queue name of a queue. */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dlq`;
}

/** Returns the name of a delay queue. */
export function retryQueueName(queue: string, delayMs: number): string {
  return `${queue}.retry.${delayMs}`;
}
