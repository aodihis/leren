import { describe, expect, it } from "vitest";
import { NOT_APPLICABLE, metricRates } from "./gate";
import type { GateInput } from "./gate";

type Entry = { metricName: string; outcome: { outcome: string; comment?: string } };

const caseResult = (metrics: Entry[], targetStatus = "succeeded") => ({ targetStatus, metrics });

const suite = (results: ReturnType<typeof caseResult>[]): GateInput => ({ name: "suite", results });

describe("metricRates", () => {
  it("counts only the cases that the metric applies to", () => {
    const result = suite([
      caseResult([{ metricName: "m", outcome: { outcome: "pass" } }]),
      caseResult([{ metricName: "m", outcome: { outcome: "fail" } }]),
      caseResult([{ metricName: "m", outcome: { outcome: "pass", comment: NOT_APPLICABLE } }]),
    ]);

    expect(metricRates(result, { m: 0.5 })).toEqual([
      { metric: "m", applicable: 2, passed: 1, rate: 0.5, threshold: 0.5 },
    ]);
  });

  it("counts a failed target and an invalid result as failures", () => {
    const result = suite([
      caseResult([], "failed"),
      caseResult([{ metricName: "m", outcome: { outcome: "invalid" } }]),
    ]);

    expect(metricRates(result, { m: 1 })[0]?.rate).toBe(0);
  });
});
