import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** The part of an eval suite result that the proposals are built from. */
export interface ProposalInput<Output = unknown> {
  readonly name: string;
  readonly results: readonly {
    readonly case: { readonly id: string; readonly input: unknown; readonly expected?: unknown };
    readonly output?: Output | undefined;
    readonly metrics: readonly {
      readonly metricName: string;
      readonly outcome: { readonly outcome: string; readonly comment?: string | undefined };
    }[];
  }[];
}

/** A metric that did not pass for a case, with the reason that the metric gave. */
export interface FailedMetric {
  readonly metric: string;
  readonly outcome: string;
  readonly comment?: string | undefined;
}

/**
 * A draft of a new eval case. `input` and `expected` are copied from the case that produced it, and
 * a person must review `expected` before the draft becomes a case, because a failure can show a
 * wrong expectation as well as a wrong behavior.
 */
export interface CaseProposal<Output = unknown> {
  /** The id of the suite that produced the draft. */
  readonly suite: string;
  /** The id of the case that produced the draft. */
  readonly sourceCaseId: string;
  /** The id that the new case would get. A case that only had a rejected draft ends in `-revised`. */
  readonly id: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly output: Output | undefined;
  readonly failedMetrics: readonly FailedMetric[];
  /** What the evaluator found wrong in each draft of the reply that it rejected. */
  readonly rejectedDrafts: readonly string[];
}

/** Options of `proposeCases`. */
export interface ProposeOptions<Output = unknown> {
  /** Reads the issues of the rejected drafts from the output of a case. */
  readonly rejectedDrafts?: (output: Output) => readonly string[];
}

/**
 * Builds a draft for each case that failed, was invalid, errored, or had a draft that the
 * evaluator rejected. A case that passed cleanly yields nothing. An errored case is found through
 * its metrics, because the eval runner records every metric of a failed target as `invalid` with
 * the target error as the comment.
 */
export function proposeCases<Output>(
  result: ProposalInput<Output>,
  options: ProposeOptions<Output> = {},
): CaseProposal<Output>[] {
  return result.results.flatMap((entry) => {
    const failedMetrics: FailedMetric[] = entry.metrics
      .filter((metric) => metric.outcome.outcome !== "pass")
      .map((metric) => ({
        metric: metric.metricName,
        outcome: metric.outcome.outcome,
        comment: metric.outcome.comment,
      }));

    const rejectedDrafts =
      entry.output === undefined ? [] : (options.rejectedDrafts?.(entry.output) ?? []);

    if (failedMetrics.length === 0 && rejectedDrafts.length === 0) {
      return [];
    }

    return [
      {
        suite: result.name,
        sourceCaseId: entry.case.id,
        id: `${entry.case.id}${failedMetrics.length > 0 ? "-regression" : "-revised"}`,
        input: entry.case.input,
        expected: entry.case.expected,
        output: entry.output,
        failedMetrics,
        rejectedDrafts,
      },
    ];
  });
}

/** The environment variable that names the directory to which `saveProposals` writes. */
export const PROPOSALS_DIR_ENV = "EVAL_PROPOSALS_DIR";

/**
 * Writes the drafts of one suite to `<dir>/<suite>.json` and returns the path, or returns
 * `undefined` when there is nothing to write. The directory is `EVAL_PROPOSALS_DIR`, and nothing is
 * written when it is not set.
 */
export async function saveProposals<Output>(
  result: ProposalInput<Output>,
  options: ProposeOptions<Output> = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | undefined> {
  const dir = env[PROPOSALS_DIR_ENV];

  if (!dir) {
    return undefined;
  }

  const proposals = proposeCases(result, options);

  if (proposals.length === 0) {
    return undefined;
  }

  const path = join(dir, `${basename(result.name)}.json`);

  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(proposals, null, 2)}\n`, "utf8");
  console.log(`Wrote ${proposals.length} case draft(s) to ${path}`);

  return path;
}
