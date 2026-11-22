# Metric catalog

Choose metrics by the question they answer. Each entry gives the question, the grader type, and the
good and bad cases to write. Use whatever name the repo's library gives the metric.

## Contents

- Deterministic metrics
- Judge-based metrics
- Trajectory metrics
- Choosing and tuning

## Deterministic metrics

Use these first. They are free, instant and repeatable, so they can run on every change.

| Metric                  | Question                                                    | Good case                         | Bad case                          |
| ----------------------- | ----------------------------------------------------------- | --------------------------------- | --------------------------------- |
| Exact match             | Is the output exactly the expected value?                   | A classification label is right   | A wrong label                     |
| Contains / not contains | Does the output include, or avoid, a string?                | A required disclaimer is present  | A secret or internal marker leaks |
| Regex match             | Does the output follow a pattern?                           | An id or date has the right shape | Markup or a raw tool call shows   |
| Max length              | Is the output short enough?                                 | A greeting gets a short reply     | A reply far over the limit        |
| JSON or schema validity | Is the output valid for the schema?                         | Valid structured output           | A missing required field          |
| Required fields         | Are all the fields present?                                 | All fields set                    | One field empty                   |
| Tool called             | Did the agent call the right tool with the right arguments? | A lookup calls the search tool    | A lookup answered from memory     |

A bad case for a deterministic metric is a request where the right behaviour is a check that a rule
can make, such as "no write tool was called". The agent runs for real, and the case expects a pass.

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

### Relevancy: good and bad

- Good: a direct question, a multi-part question, a question with a short correct answer.
- Bad: a request that tempts the agent to drift to another subject, to bury the answer among
  unrelated statements, or to restate the question without answering it. The right answer stays on
  topic.

### Faithfulness: good and bad

- Good: a summary built only from the context.
- Bad: a question about a number, a name or a status that the context does not hold, or that
  invites a claim that the context contradicts. The right answer says that the context does not
  hold it, or states what the context says.

Faithfulness checks support, not truth. A true statement that the context does not support still
counts against faithfulness. Relevancy and faithfulness are independent, so write cases that fail
one and pass the other: a question that tempts a faithful but off-topic answer, and one that
tempts a relevant but unfaithful answer.

### Abstention: good and bad

- Good: an answerable request that gets a real answer.
- Bad: an unanswerable request, such as a made-up product, where the right behaviour is to say that
  the data does not hold the answer. Also write a case that an over-cautious agent would wrongly
  refuse, where the right behaviour is to answer.

## Trajectory metrics

Use these only when the steps matter. Check the tools called, their order, the number of turns and
whether the agent stopped when it should. Prefer checking the final result when either would do.

## Choosing and tuning

1. Start with the failure you fear most, and pick the metric that would catch it.
2. Add a deterministic metric for every property a rule can check.
3. Add a judge metric only for meaning that a rule cannot capture.
4. Run the good and bad cases several times, and set the threshold below the scores that a careful person would accept.
5. Re-check thresholds when you change the judge model, because scales differ between models.
6. Keep each case small and about one behaviour, so a failure points to one cause.
