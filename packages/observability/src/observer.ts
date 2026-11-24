import type { EvalReporter } from "@anvia/core/evals";
import type { AgentObservabilityOptions } from "@anvia/core/observability";
import type { PipelineObservabilityOptions } from "@anvia/core/pipeline";

/** The vendor-neutral surface for tracing. */
export interface Observer {
  readonly enabled: boolean;

  /** Returns the agent observability options. */
  forAgent(): AgentObservabilityOptions | undefined;

  /** Returns the pipeline observability options. */
  forPipeline(): PipelineObservabilityOptions | undefined;

  /** Returns a reporter that records eval results. */
  evalReporter(): EvalReporter | undefined;

  /** Delivers buffered telemetry. */
  flush(): Promise<void>;

  /** Delivers telemetry and releases resources. */
  close(): Promise<void>;
}

/** Environment variables as read from `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;
