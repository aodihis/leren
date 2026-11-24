import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROPOSALS_DIR_ENV, proposeCases, saveProposals } from "./propose";
import type { ProposalInput } from "./propose";

const entry = (
  id: string,
  outcome: string,
  extra: Partial<ProposalInput["results"][number]> = {},
): ProposalInput["results"][number] => ({
  case: { id, input: { email: id }, expected: { outcome: "answer" } },
  output: { rejected: [] },
  metrics: [{ metricName: "outcome", outcome: { outcome, comment: `${id} ${outcome}` } }],
  ...extra,
});

const rejected = (output: unknown) => (output as { rejected: string[] }).rejected;

describe("proposeCases", () => {
  it("drafts a case for a failed metric and skips a clean pass", () => {
    const result = { name: "pipeline", results: [entry("ok", "pass"), entry("bad", "fail")] };

    expect(proposeCases(result)).toEqual([
      {
        suite: "pipeline",
        sourceCaseId: "bad",
        id: "bad-regression",
        input: { email: "bad" },
        expected: { outcome: "answer" },
        output: { rejected: [] },
        failedMetrics: [{ metric: "outcome", outcome: "fail", comment: "bad fail" }],
        rejectedDrafts: [],
      },
    ]);
  });

  it("drafts a case whose run passed but had a rejected draft", () => {
    const result = {
      name: "pipeline",
      results: [entry("revised", "pass", { output: { rejected: ["Not grounded."] } })],
    };

    const [proposal] = proposeCases(result, { rejectedDrafts: rejected });

    expect(proposal?.rejectedDrafts).toEqual(["Not grounded."]);
    expect(proposal?.failedMetrics).toEqual([]);
  });

  it("drafts a case whose target errored", () => {
    const result = {
      name: "pipeline",
      results: [
        entry("broken", "invalid", {
          output: undefined,
          metrics: [
            {
              metricName: "outcome",
              outcome: { outcome: "invalid", comment: "Target failed: boom" },
            },
          ],
        }),
      ],
    };

    const [proposal] = proposeCases(result, { rejectedDrafts: rejected });

    expect(proposal?.id).toBe("broken-regression");
    expect(proposal?.failedMetrics).toEqual([
      { metric: "outcome", outcome: "invalid", comment: "Target failed: boom" },
    ]);
  });
});

describe("saveProposals", () => {
  const result = { name: "pipeline", results: [entry("bad", "fail")] };

  it("writes nothing when the directory is not set", async () => {
    await expect(saveProposals(result, {}, {})).resolves.toBeUndefined();
  });

  it("writes the drafts of the suite to the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "proposals-"));
    const path = await saveProposals(result, {}, { [PROPOSALS_DIR_ENV]: dir });

    expect(path).toBe(join(dir, "pipeline.json"));
    expect(JSON.parse(await readFile(join(dir, "pipeline.json"), "utf8"))).toHaveLength(1);
  });

  it("writes nothing when every case is clean", async () => {
    const clean = { name: "pipeline", results: [entry("ok", "pass")] };

    await expect(
      saveProposals(clean, {}, { [PROPOSALS_DIR_ENV]: "unused" }),
    ).resolves.toBeUndefined();
  });
});
