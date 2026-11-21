# Metric catalog

Choose metrics by the question they answer. Each entry gives the question, the grader type, and the
positive and negative cases to write. Use whatever name the repo's library gives the metric.

## Contents

- Deterministic metrics
- Judge-based metrics
- Trajectory metrics
- Choosing and tuning

## Deterministic metrics

Use these first. They are free, instant and repeatable, so they can run on every change.

| Metric                  | Question                                                    | Positive case                     | Negative case                     |
| ----------------------- | ----------------------------------------------------------- | --------------------------------- | --------------------------------- |
| Exact match             | Is the output exactly the expected value?                   | A classification label is right   | A wrong label                     |
| Contains / not contains | Does the output include, or avoid, a string?                | A required disclaimer is present  | A secret or internal marker leaks |
| Regex match             | Does the output follow a pattern?                           | An id or date has the right shape | Markup or a raw tool call shows   |
| Max length              | Is the output short enough?                                 | A greeting gets a short reply     | A reply far over the limit        |
| JSON or schema validity | Is the output valid for the schema?                         | Valid structured output           | A missing required field          |
| Required fields         | Are all the fields present?                                 | All fields set                    | One field empty                   |
| Tool called             | Did the agent call the right tool with the right arguments? | A lookup calls the search tool    | A lookup answered from memory     |

Negative cases for deterministic metrics need a fixed bad output, because a real agent will not
produce a leak or an overlong reply on request.

## Judge-based metrics

A judge model grades the output against a rubric. Results vary, so compare a score to a threshold.

| Metric                              | Question                                                              | Needs in the case                    |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| Answer relevancy                    | Does the answer address the question asked?                           | Input                                |
| Faithfulness                        | Is every claim supported by the supplied context?                     | Retrieval context                    |
| Hallucination                       | Does the answer contradict or invent beyond the context?              | Context                              |
| Contextual relevancy                | Is the retrieved context relevant to the question?                    | Retrieval context                    |
| Abstention                          | Does the agent decline when it cannot answer, and answer when it can? | Input, and whether it should abstain |
| Prompt alignment                    | Does the answer follow the instructions in the system prompt?         | The instructions                     |
| Summarization                       | Does a summary keep the key facts and add none?                       | Source text                          |
| Semantic similarity                 | Is the answer close in meaning to a reference answer?                 | Reference answer                     |
| Custom criteria                     | Does the answer meet a rubric, such as tone or policy?                | Written criteria                     |
| Turn relevancy, knowledge retention | Does a multi-turn conversation stay on topic and remember facts?      | Conversation turns                   |

### Relevancy: positive and negative

- Positive: a direct question, a multi-part question, a question with a short correct answer.
- Negative: an answer about another subject, an answer with one relevant sentence among unrelated
  statements, an answer that restates the question without answering it.

### Faithfulness: positive and negative

- Positive: a summary built only from the context, an answer that says the context does not cover
  the question.
- Negative: an answer that adds a number or name the context lacks, an answer that contradicts the
  context, an answer that mixes supported and unsupported claims.

Faithfulness checks support, not truth. A true statement that the context does not support still
counts against faithfulness. Relevancy and faithfulness are independent, so write cases that fail
one and pass the other: a faithful but off-topic answer, and a relevant but unfaithful one.

### Abstention: positive and negative

- Positive: an answerable request that gets a real answer, an unanswerable request (a made-up
  product) that gets a refusal.
- Negative: a refusal of an answerable request (over-refusal), a confident answer to a made-up
  topic.

## Trajectory metrics

Use these only when the steps matter. Check the tools called, their order, the number of turns and
whether the agent stopped when it should. Prefer checking the final result when either would do.

## Choosing and tuning

1. Start with the failure you fear most, and pick the metric that would catch it.
2. Add a deterministic metric for every property a rule can check.
3. Add a judge metric only for meaning that a rule cannot capture.
4. Run the positive and negative cases, and set the threshold between the two groups of scores.
5. Re-check thresholds when you change the judge model, because scales differ between models.
6. Keep each case small and about one behaviour, so a failure points to one cause.
