import { createObserver } from "@leren/observability";

/** The observer that every eval of the reply agents shares. */
export const observer = createObserver();

/** The reporters that record eval results next to their traces. Empty when tracing is off. */
export const reporters = [observer.evalReporter()].filter((reporter) => reporter !== undefined);

/** Flushes the traces that the observer collected. Call it when all evals have finished. */
export async function closeObserver(): Promise<void> {
  await observer.close();
}
