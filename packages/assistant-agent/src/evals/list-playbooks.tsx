import { containsAll, doesNotMatch, runEvalCli } from "@anvia/core/evals";
import { anyOf } from "./graders";
import { listPlaybooksCases } from "./list-playbooks-cases";
import { reporters, target } from "./target";
import type { AssistantEvalInput, AssistantEvalOutput } from "./target";
import type { ListExpectation } from "./list-playbooks-cases";

await runEvalCli({
  name: "list-playbooks",
  cases: listPlaybooksCases,
  target,
  reporters,
  concurrency: 2,
  metrics: [
    containsAll<AssistantEvalInput, AssistantEvalOutput, ListExpectation>({
      name: "names-expected-playbooks",
      actual: ({ output }) => output.text,
      expected: ({ case: testCase }) => testCase.expected?.contains ?? [],
    }),
    doesNotMatch<AssistantEvalInput, AssistantEvalOutput, ListExpectation>({
      name: "omits-other-playbooks",
      actual: ({ output }) => output.text,
      expected: ({ case: testCase }) => anyOf(testCase.expected?.excludes ?? []),
    }),
  ],
  exitCode: true,
});
