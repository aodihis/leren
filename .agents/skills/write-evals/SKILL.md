---
name: write-evals
description: How to write, extend and run AI evaluations (evals) for an agent or LLM feature, in a fixed file layout with a cases file and a runner file per metric, an index runner, and a `pnpm run evals <metric>` script. Use this skill whenever the user asks to add, write, change or review an eval, an evaluation, a metric, a test dataset for an agent, an LLM judge, relevancy, faithfulness, hallucination, abstention, grounding, format or safety checks, or says "test the agent's answers" or "how do we know the agent got better", even if they never say the word "eval". Works with any eval library, so also use it when the user switches libraries.
---

# Writing AI evals

An eval is a test for non-deterministic software: give the agent an input, grade the output, and
report a score. Unit tests cannot do this, because the same input can produce different valid
answers. This skill fixes the shape of the files so every eval looks the same, whatever library
runs it.

## Library-agnostic rule

The structure below does not depend on a library. Before writing anything, find out which eval
library the repo uses: read the existing `evals/` folder, the dependencies in `package.json` and
the library's own docs. Map the generic terms here to that library's names:

| Generic term | What to look for in the library                                                    |
| ------------ | ---------------------------------------------------------------------------------- |
| case         | A record with an id, an input and optional expected data or context                |
| target       | The function that takes a case input and returns the output to grade               |
| metric       | A scorer that returns pass/fail or a number. Deterministic or judge-based          |
| judge model  | The model that a judge-based metric calls to grade an output                       |
| runner       | The function that runs cases through the target and the metrics, such as `runEval` |
| reporter     | An optional sink for results, such as a console or a tracing backend               |

Never invent a metric the library lacks. If the library has no built-in for the metric you need,
write a small custom metric, or grade with a generic "criteria" judge metric if one exists.

## File layout

All evals live in one `evals/` folder. Use the folder that already exists. In a monorepo that is
usually next to the agent being tested. Create one only when none exists.

```
evals/
  index.tsx                  runs one or all evals by name
  <metric>-cases.tsx         the cases for one metric
  <metric>.tsx               prepares and runs that metric
  target.ts                  the function under test, shared (create it once)
  models.ts                  judge and agent model setup, shared (create it once)
```

Keep one metric per pair of files, named in kebab-case: `answer-relevancy-cases.tsx` and
`answer-relevancy.tsx`. Duplication between metric files is fine. Each file should be readable on
its own, and a shared helper that every file needs to understand costs more than a few repeated
lines. Only `target.ts` and `models.ts` are shared, because they wire real services.

### `<metric>-cases.tsx`

Export one array of cases, named `<metric>Cases`. Each case has an `id`, an `input`, and whatever
the metric needs (`expected`, `retrievalContext`, a reference answer). Give every case a stable
kebab-case id that says what the case tests, because ids appear in reports and in the CLI filter.

```ts
export const abstentionCases = [
  {
    id: "no-useful-result",
    input: "Research the latest news about the fictional 'Blorptonic-9' keyboard launch.",
    expected: true,
  },
  {
    id: "grounded-summary",
    input: "Using only this report, summarize the news: '<report text>'",
    expected: false,
    retrievalContext: ["The report states that ..."],
  },
];
```

Record why each case exists, in a comment above it or a `note` field. Follow the repo's comment
rules: if a lint rule forbids inline comments, use the `note` field. Static context in the case
keeps a grounded-answer check judgeable, because the judge needs a fixed source of truth.

### `<metric>.tsx`

Import the cases, the target, the judge model if the metric needs one, and the library's runner and
metric. Build the runner call, run it, print or return the results, and set a failing exit code.
Keep it flat and short, with no abstractions.

```ts
import { abstention, runEval } from "<eval-library>";
import { getJudgeModel } from "./models";
import { abstentionCases } from "./abstention-cases";
import { target } from "./target";

const result = await runEval({
  name: "abstention",
  cases: abstentionCases,
  target,
  concurrency: 1,
  metrics: [
    abstention({ model: getJudgeModel(), shouldAbstain: ({ case: c }) => c.expected === true }),
  ],
});
console.log(result.results);
```

Use `concurrency: 1` for judge-based metrics unless the provider's rate limits are known, because
parallel judge calls cause flaky rate-limit failures that look like eval failures.

### `index.tsx` and the scripts

`index.tsx` holds a registry from a metric name to its file, reads the names from the command line,
and runs the named evals, or all of them when none is named. Unknown names print the available
names and exit non-zero. Each metric file runs when it is imported, so the registry maps a name to a
dynamic import.

Add two scripts, so the user only ever types:

```
pnpm run evals               # all evals
pnpm run evals relevancy     # one eval
```

In a monorepo, define `evals` in the package that owns the evals and a root script that forwards to
it. Extra arguments reach the script, so no `--` is needed. Follow the repo's existing convention
for loading environment files and secrets, such as a `:secure` variant. When you add a metric, add
it to the registry in `index.tsx`, and nowhere else.

## Choose metrics from several perspectives

One metric cannot judge an agent. Pick metrics from different perspectives, and cover each
perspective you can with a deterministic check before reaching for a judge. Read
`references/metric-catalog.md` for the full list, what each perspective catches, and what cases to
write. In short:

- **Deterministic** (exact match, contains, regex, length, schema, tool called): free, fast,
  repeatable. Use them for format, safety strings, structured output and required tool use.
- **Judge-based** (relevancy, faithfulness, hallucination, abstention, tone, criteria): needed
  for meaning. Slower, costs tokens, and varies between runs, so use a threshold, not equality.
- **Trajectory** (which tools ran, in what order, how many turns): checks the path when the path
  matters, such as cost or required steps.

## Positive and negative cases

Every metric needs both kinds of cases. A metric that only sees good outputs can pass while being
blind, because a judge that always says "fine" scores 100%.

- A **positive case** is an input where the agent should do well. The metric must pass.
- A **negative case** is an input or output where the metric must fail, which proves the metric can
  detect the problem. The agent usually does not produce bad outputs on request, so give the case a
  fixed bad output that replaces the agent's answer.

Mark each case with the result it expects (`expected: "pass"` or `"fail"`), have the target return
the case's fixed output when it has one, and compare each outcome to that expectation. Do not use
the library's own exit code for this, because a negative case that correctly fails would then fail
the run. Instead, report mismatches and set the exit code yourself.

For the two most important judge metrics:

- **Relevancy** asks whether the answer addresses the question. Positive: on-topic and multi-part
  questions. Negative: an off-topic answer, and an answer that buries one relevant sentence in
  unrelated statements.
- **Faithfulness** asks whether every claim is supported by the supplied context. Positive: an
  answer built only from the context. Negative: an answer that adds a fact the context lacks, and
  an answer that contradicts the context. Always supply the context in the case, so the judge
  has a fixed source of truth.

## Procedure

1. Identify the library and the existing `evals/` layout. Reuse `target.ts` and `models.ts` if they
   exist.
2. Choose the metrics and name the behaviour each one protects. Prefer a deterministic metric when
   one is enough.
3. Write `<metric>-cases.tsx` with at least two positive and two negative cases, each with a stable
   id and a stated reason.
4. Write `<metric>.tsx`, then register it in `index.tsx`.
5. Run `pnpm run evals <metric>`. Check that the positive cases pass and the negative cases fail.
   If a negative case passes, the metric or the threshold is too lenient, so fix that before
   trusting the eval.
6. Read some raw outputs and judge reasons. Graders can be wrong, and an eval is only as good as
   its grader.
7. Run the repo's lint, format check and typecheck, and report anything you could not run.

## Pitfalls

- **Grading the path instead of the result.** Grade what the agent produced, unless the steps
  themselves are the requirement. Rigid step checks fail good agents that took another route.
- **A judge that grades its own work.** Use a different model for judging than for the agent when
  you can.
- **Thresholds set once and never checked.** Set them from observed scores on positive and negative
  cases, with a margin between the two groups.
- **Ambiguous cases.** If two careful people could disagree about the expected result, rewrite the
  case. A flaky case teaches nothing.
- **Real secrets or personal data in cases.** Cases are committed. Use invented data.
- **Only testing the happy path.** Add refusals, empty results, wrong-language inputs and
  adversarial inputs.

Sources and further reading are in `references/sources.md`.
