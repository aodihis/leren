/** The part of a suite result that the gate reads. */
export interface GateInput {
  readonly name: string;
  readonly results: readonly {
    readonly targetStatus: string;
    readonly metrics: readonly {
      readonly metricName: string;
      readonly outcome: { readonly outcome: string; readonly comment?: string | undefined };
    }[];
  }[];
}

/** The comment of a not applicable passing result. */
export const NOT_APPLICABLE = "not applicable";

/** The lowest pass rate of each named metric. */
export type Thresholds = Readonly<Record<string, number>>;

/** The pass rate of one metric. */
export interface MetricRate {
  readonly metric: string;
  readonly applicable: number;
  readonly passed: number;
  readonly rate: number;
  readonly threshold: number;
}

/** Computes the pass rate of each metric. */
export function metricRates(result: GateInput, thresholds: Thresholds): MetricRate[] {
  return Object.entries(thresholds).map(([metric, threshold]) => {
    const outcomes = result.results.flatMap((caseResult) => {
      if (caseResult.targetStatus === "failed") {
        return [false];
      }

      const found = caseResult.metrics.find((entry) => entry.metricName === metric)?.outcome;

      return !found || found.comment === NOT_APPLICABLE ? [] : [found.outcome === "pass"];
    });

    const passed = outcomes.filter(Boolean).length;
    const rate = outcomes.length === 0 ? 1 : passed / outcomes.length;

    return { metric, applicable: outcomes.length, passed, rate, threshold };
  });
}

/** Prints the quality gate and sets the exit code. */
export function applyGate(result: GateInput, thresholds: Thresholds): boolean {
  const rates = metricRates(result, thresholds);

  console.log(`\nQuality gate: ${result.name}`);

  for (const entry of rates) {
    const state = entry.rate >= entry.threshold ? "PASS" : "FAIL";
    const percent = (entry.rate * 100).toFixed(0);
    const minimum = (entry.threshold * 100).toFixed(0);

    console.log(
      `  ${state} ${entry.metric}: ${entry.passed}/${entry.applicable} (${percent}%, minimum ${minimum}%)`,
    );
  }

  const passed = rates.every((entry) => entry.rate >= entry.threshold);

  if (!passed) {
    process.exitCode = 1;
  }

  return passed;
}
