import type { EvalReporter } from "@anvia/core/evals";
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

  /**
   * Returns a reporter that records eval results next to the traces of the agent runs they grade,
   * or `undefined` when tracing is disabled. The reporter includes the inputs and outputs of the
   * cases, so use it only for evals whose cases hold invented data.
   */
  evalReporter(): EvalReporter | undefined;

  /** Delivers buffered telemetry. Short-lived processes call it before exiting. */
  flush(): Promise<void>;

  /** Delivers buffered telemetry and releases resources. Call it once during shutdown. */
  close(): Promise<void>;
}

/** Environment variables as read from `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;
