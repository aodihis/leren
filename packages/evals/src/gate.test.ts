import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_APPLICABLE, applyGate, metricRates } from "./gate";
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

describe("applyGate", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("passes and prints each metric when every rate reaches its threshold", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = suite([caseResult([{ metricName: "m", outcome: { outcome: "pass" } }])]);

    expect(applyGate(result, { m: 0.9 })).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalledWith("  PASS m: 1/1 (100%, minimum 90%)");
  });

  it("fails and sets a failing exit code when a rate is below its threshold", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = suite([caseResult([{ metricName: "m", outcome: { outcome: "fail" } }])]);

    expect(applyGate(result, { m: 0.5 })).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith("  FAIL m: 0/1 (0%, minimum 50%)");
  });
});
