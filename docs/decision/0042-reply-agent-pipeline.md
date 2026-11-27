# 0042. The Reply Agent runs inside a fixed pipeline with an evaluator-optimizer loop and guardrails

- Status: Superseded
- Date: 2026-11-22
- Affects: packages/reply-agent, apps/worker, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md
- Superseded by: [0066](0066-answer-agent-and-style-step.md)

## Context

The Reply Agent drafts an answer to one email that the gate has accepted. Its output may reach a real person, its input is untrusted, and decision [0037](0037-drop-routing-rules.md) leaves `delegate` and `escalate` to its judgment. A single agent run with a prompt does not check its own answer, and safety that depends on a model following a prompt is not safety.

`@anvia/core/pipeline` provides `Pipeline` with the stages `step`, `agent`, `extract`, `decide`, `route` and `parallel`. It has no loop. Anvia agents accept input and output guardrails that allow, block or rewrite text.

## Decision

The Reply Agent is one stage of a fixed pipeline built with `Pipeline`. One state object passes from step to step, because a stage receives only the output of the previous one. The pattern is prompt chaining with routing, around a small tool-using agent, with a bounded evaluator-optimizer loop and deterministic guardrails. It is not a free-roaming agent and not a team of agents.

The stages run in this order for one message:

1. **Input guardrail.** Code truncates the email, removes hidden and control text, and wraps the email as untrusted data. It flags injection patterns and does not block on them.
2. **Triage.** A cheap model classifies the email as a project question, task assignment, informational, urgent or other, lists each distinct question or request in it, and flags suspected injection. It also makes the mention check when the gate returned `check_mention`.
3. **Retrieve.** A code step calls the `search_playbooks` MCP tool once for each question of the triage, at most 5, with the message-bound session, and merges the playbooks. Retrieval stays on MCP. When no question returns a playbook, the pipeline abstains: the outcome is `escalate` and the drafting agent is not called. A question without a playbook is passed to the drafter, which must not answer it.
4. **Route.** A decision chooses `answer`, `delegate` or `escalate` from the `contacts` and `restrictions` of the retrieved playbooks. `delegate` and `escalate` use a short fixed layout and are not drafted freely.
5. **Draft.** The Reply Agent receives the retrieved playbooks and the user's reply instructions as context. It has the read-only MCP search tools, so it can search again for a question that the first search did not cover. It has at most 5 turns and no write tool. The playbooks that its own searches return count as retrieved for stage 6. It returns structured output: the outcome, the body, the ids of the playbooks it cites, an optional contact and a confidence.
6. **Evaluate and optimize.** Deterministic checks run first: the output matches the schema, every cited id is one that stage 3 or a search of the agent returned, the length is in range, and the system prompt is not repeated. Then a judge model, which is not the drafting model, scores the draft against the playbooks from stage 3, the playbooks' restrictions and contacts, the reply instructions and the original email. It returns a pass or fail for each criterion and written feedback. The criteria are groundedness, coverage of every question (answered, or explicitly deferred), rule compliance, instruction compliance and injection safety. On a fail, the feedback goes back to stage 5 for a revision. After 2 revisions that still fail, the outcome is `escalate` with the failure reasons.
7. **Output guardrail.** A code check blocks credential patterns, an answer without citations and a repeated system prompt. A block makes the outcome `escalate`.
8. **Persist.** The pipeline returns the result, and its caller, the `email.process` consumer, saves the decision and the draft and moves the message status with `transitionMessage` (decision [0039](0039-email-record-reply-mode-and-gate.md)). The pipeline has no database dependency, so it runs the same way in the worker and in an evaluation.

Further rules:

- One typed state object passes through the stages. It keeps the playbooks from stage 3, so the judge in stage 6 compares the draft with the same knowledge the drafter used, and the knowledge is not retrieved twice.
- URLs, email addresses and phone numbers in a reply are normal content, for example a contact written in a playbook. The checks do not restrict them. The judge treats a detail as grounded when it appears in a retrieved playbook.
- Guardrails are code and fail closed. The evaluator improves quality and returns feedback. An error in the evaluator or a guardrail leads to `escalate` and never to a sent reply.
- The agent has no tool that changes data. The `reply` role keeps `playbooks:read` only, and the caller of the pipeline persists the result, after stage 7. No stage sends email.
- The user may write reply instructions, such as a persona or a tone. They are trusted input. They enter the drafter's prompt in a labeled section below the fixed rules, so they cannot override the handling of untrusted email, the citations or the ban on sending. The judge checks the draft against them. The pipeline takes them as an optional input. Storing and editing them is a separate feature and needs a product decision.
- Reply templates are not part of this decision. The draft body is free text, so a template can wrap it later.
- The judge model is chosen by `REPLY_JUDGE_MODEL`, and the triage model by `REPLY_TRIAGE_MODEL`, in the way decision [0025](0025-model-per-task-from-environment.md) describes. An unset variable selects the model of `REPLY_MODEL`.
- The worker opens the MCP session of a run with `mintSession` from `@leren/mcp-server`, for the user in the message record and not the one in the job. The token is short-lived, is bound to that user and the message id, and carries the read-only scopes of the reply role. It is not single-use, because one run opens several MCP connections and a retry of the job needs a new session. The worker revokes the session when the run ends. It needs the `MCP_SESSION_SECRET` that the API uses.
- The pipeline is traced as one run, and each stage is a span in it, through the `forPipeline()` option of the observer. The stages that are one completion have no span of their own for the model call, so the span of the stage is their trace. The drafting agent is traced as an agent run in the span of its stage.
- A stage uses an agent only when it needs tools. The drafting agent has the read-only search tools. Triage, routing and the judge classify or score what the pipeline gives them, so each is one completion without tools. This keeps the judge independent of the drafter, because it cannot look up anything for itself.
- A run makes at most one triage call, three drafts of 5 turns each and three judge calls.

Each stage takes typed input and returns typed output, so it can be evaluated alone and end to end. The evaluation suite measures triage accuracy, Recall@5, correct abstention, routing accuracy, groundedness, rule compliance, instruction compliance and injection resistance. It also measures the judge, by its agreement with human labels on good and deliberately bad drafts, and the optimizer, by the pass rate before and after revision.

## Consequences

- Unreliable retrieval cannot produce an invented answer, because the pipeline stops before the drafting agent.
- A draft that fails the judge or a guardrail is never saved as a reply. It becomes an escalation with the reasons.
- A run costs more model calls than a single agent run, bounded as stated above. The loop limit and the cheaper triage model keep the cost predictable.
- The judge is a model and can be wrong, so its quality is measured and has its own quality gate.
- The worker consumer for `email.process` only loads the message, runs the pipeline and acknowledges. The decision logic lives in `packages/reply-agent`.
- The storage of decisions and drafts and the reading of reply instructions are supplied by the caller and are built with the `email.process` consumer.
