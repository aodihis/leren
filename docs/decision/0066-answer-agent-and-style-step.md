# 0066. The Reply Agent searches and decides, and a separate stage applies the style

- Status: Accepted
- Date: 2026-11-27
- Affects: packages/reply-agent, packages/agents, apps/worker, harness.config.ts, prompts/reply.md, prompts/reply-judge.md, prompts/reply-style.md, prompts/reply-style-judge.md, docs/overview/README.md

## Context

Decision [0042](0042-reply-agent-pipeline.md) runs retrieval as a code step that searches once for each question of the triage, a routing model that chooses to answer or escalate, and a drafting agent that may search again. An email with several questions is searched twice, and the drafter already has the search tools. The drafter also had to write correct content and apply the persona and the tone of the reply instructions in one answer, and one judge scored both, so a failed persona sent the whole draft back for a revision that could search again. No stage limited how much a model writes.

## Decision

The stages run in this order for one message:

1. **Input guardrail.** Unchanged from decision 0042.
2. **Triage.** Unchanged from decision 0042.
3. **Answer.** The Reply Agent receives the email and the questions of the triage. It calls the read-only MCP search tools itself, for each question, decides whether to answer or escalate, and writes the content of the reply with the ids of the playbooks it cites. It follows what the instructions of the playbooks and the default reply instructions forbid, and leaves the persona and the tone to stage 4. An `escalate` ends the run with the agent's reason. Abstention stays in code: an answer for which the agent's searches returned no playbook that the gate allows ends in `escalate`, and no judge is called. The agent has at most 6 turns.
4. **Evaluate the content.** The checks that need no model run first, as in decision 0042. Then the content judge scores groundedness, coverage, rule compliance with the prohibitions of the instructions, and injection safety. A fail goes back to stage 3 as feedback, with the playbooks found so far, at most 2 times, and then ends in `escalate`.
5. **Style.** One completion without tools rewrites the passed content with the default reply instructions and the instructions of the cited playbooks. It may not change a fact. The styled reply is checked once: the checks that need no model, including the credential patterns and the canary, then the style judge, which compares it with the content draft for faithfulness, instruction compliance, rule compliance and injection safety. It is never revised. A styled reply that fails, or an answer that cannot be read, is discarded and the content draft from stage 4 is used, with the reason in the result. The stage is skipped when there are no default reply instructions and no cited playbook has an instruction.
6. **Output guardrail** and **persist.** Unchanged from decision 0042.

Further rules:

- Every model call has an output token limit: 600 for triage, 1500 for each turn of the agent, 1200 for the style stage and 800 for each judge. The longest reply body is 3000 characters. An answer that is cut off is not valid JSON and is treated as unreadable.
- The answering agent has the MCP tools `search_playbooks` and `get_playbook`, and not `list_playbooks`, because every playbook that its tools return counts as found for the abstention check.
- A call of a playbook tool that fails is a server or authorization problem. It throws, so that the queue retries the message, and it is never recorded as an escalation.
- The style stage runs on the model of the Reply Agent, and both judges run on the judge model.
- A run makes at most one triage call, three agent runs of 6 turns each, three content judge calls, one style call and one style judge call.
- The rules of decision 0042 that this decision does not change still apply. Guardrails are code and fail closed, the judge is not the drafting model, the pipeline has no database dependency, no stage sends email, and the run is traced as one pipeline.

## Consequences

- An email with several questions is searched once, by the agent, and the routing prompt and its model call are gone.
- Abstention now happens after an agent run, so an email that no playbook covers costs one agent run.
- A persona or a tone that the style stage fails to apply never escalates a reply. The checked content is sent as it is, and the reasons say why.
- A content draft must satisfy every prohibition by itself, because the style stage may be skipped or discarded.
- The evaluations that decision 0042 describes measured the old stages and are removed. A new evaluation suite will be written for these stages.
