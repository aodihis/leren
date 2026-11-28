# 0071. Every model call of the reply pipeline is traced with its model and usage

- Status: Accepted
- Date: 2026-11-28
- Affects: packages/reply-agent

## Context

Anvia Lens calculates the cost of a model call from the model name and the token usage of its generation span, with the prices that the organization configures in Lens. Only agent runs emit generation spans. Decision [0042](0042-reply-agent-pipeline.md) made triage and the judges one completion without tools, with no span of their own for the model call, and decision [0066](0066-answer-agent-and-style-step.md) kept that rule and added the style stage as another such completion. Lens therefore saw only the model of the answering agent, and the cost of triage, the style stage and both judges was missing.

`generateCompletion` from `@anvia/core` accepts no observer, and a pipeline `step` has no tracing context of its own.

## Decision

- `generateJson` runs its question as an agent with one turn, no tools and the pipeline's observer, so each completion stage is traced as an agent run with a generation span that holds its model and token usage.
- Each stage names its agent run: `reply-triage`, `reply-content-judge`, `reply-style` and `reply-style-judge`.
- The stages stay without tools, so the judges remain independent of the answering agent as decision 0042 requires. This replaces only the rule of decision 0042 that the completion stages have no span of their own.
- An agent run that ends without an answer is an unusable answer, as an invalid one is, so the stage falls back or escalates instead of the queue retrying the message.

## Consequences

- Lens shows the model, the token usage and, once its price is configured, the cost of every model call of the pipeline.
- Each agent run, including the answering agent, is a separate trace in Lens and not a child of the pipeline trace, so Lens does not total the cost of one pipeline run. Linking the agent runs to the pipeline trace is a separate change.
- A trace of a completion stage has an agent span around its generation span, which adds one level to the trace.
