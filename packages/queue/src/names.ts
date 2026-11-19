/** Returns the name of the dead-letter queue of `queue`. */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dlq`;
}

/**
 * Returns the name of the queue that holds messages of `queue` for `delayMs` before they are
 * delivered to `queue` again. The delay is part of the name because RabbitMQ fixes the time to
 * live of a queue when it is declared.
 */
export function retryQueueName(queue: string, delayMs: number): string {
  return `${queue}.retry.${delayMs}`;
}
