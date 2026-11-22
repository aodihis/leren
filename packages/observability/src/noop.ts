import type { Observer } from "./observer";

/** Creates an observer that records nothing. It is used when no tracing backend is configured. */
export function createNoopObserver(): Observer {
  return {
    enabled: false,
    forAgent: () => undefined,
    evalReporter: () => undefined,
    flush: async () => {},
    close: async () => {},
  };
}
