import type { Observer } from "./observer";

/** Creates an observer that records nothing. */
export function createNoopObserver(): Observer {
  return {
    enabled: false,
    forAgent: () => undefined,
    forPipeline: () => undefined,
    evalReporter: () => undefined,
    flush: async () => {},
    close: async () => {},
  };
}
