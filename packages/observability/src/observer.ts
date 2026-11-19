import type { AgentObservabilityOptions } from "@anvia/core/observability";

/**
 * The vendor-neutral surface that applications and packages use for tracing.
 *
 * Callers never see which backend records the traces. A backend is one implementation of this
 * interface, so replacing it changes only the factory in `index.ts`.
 */
export interface Observer {
  readonly enabled: boolean;

  /**
   * Returns the options to pass as `observability` when constructing an agent, or `undefined`
   * when tracing is disabled.
   */
  forAgent(): AgentObservabilityOptions | undefined;

  /** Delivers buffered telemetry. Short-lived processes call it before exiting. */
  flush(): Promise<void>;

  /** Delivers buffered telemetry and releases resources. Call it once during shutdown. */
  close(): Promise<void>;
}

/** Environment variables as read from `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;
