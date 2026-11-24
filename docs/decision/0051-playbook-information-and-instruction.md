# 0051. A playbook holds information and an instruction

- Status: Accepted
- Date: 2026-11-24
- Affects: packages/db, packages/knowledge, packages/mcp-server, packages/reply-agent, packages/assistant-agent, apps/api, apps/worker, apps/platform, prompts/assistant.md, prompts/reply.md, prompts/reply-judge.md, prompts/reply-route.md, docs/overview

## Context

A playbook stored `response`, `examples` and `restrictions`. The name `response` suggests a fixed answer to a question, yet a playbook is general knowledge that the Reply Agent turns into an answer for a statement, a request or a question. Example messages were meant to help retrieval, but asking for them made writing a playbook slower, and the Reply Agent reads the whole playbook anyway. Restrictions were one kind of instruction on how to answer, and the user had no place for a tone or a persona that belongs to one topic. Reply instructions were accepted by the pipeline (decisions 0042 and 0043) and never stored.

## Decision

- Replace `response`, `examples` and `restrictions` on `playbooks` with two columns. `information` is required and holds what the assistant knows about the topic, up to 5000 characters, including whom to contact. `instruction` is optional, up to 2000 characters, and says how to answer when the playbook is used, such as a tone or what must not be said. An empty instruction means that the playbook has none.
- Add `reply_instruction` to `users`. It is the default instruction of the user, up to 2000 characters, and is empty when the user has set none. The profile page edits it, through `PATCH /api/me`, where an omitted value keeps the stored one.
- An instruction of a playbook replaces the default instruction for the part of a reply that uses that playbook, and the default applies to every other part. The worker reads the default instruction of the owner of a message and passes it to the pipeline as the reply instructions. The Reply Agent, the router and the judge receive the default instruction and the instruction of each retrieved playbook, and the judge checks the draft against it. The fixed rules of the Reply Agent still take precedence over every instruction.
- Retrieval embeds the topic and the information. The instruction is not embedded, because it says how to answer and not what a message is about.
- The MCP tools `create_playbook`, `update_playbook`, `get_playbook`, `list_playbooks` and `search_playbooks` use `information` and `instruction`. The assistant asks for the topic and the information, tells the user that the instruction is optional, then asks once about the period and the senders and explains that a playbook with no start and no end is always active.
- Migrations `0018` and `0019` copy `response` into `information`, turn a non-empty `restrictions` text into an instruction that starts with "Never say the following.", and then drop the three old columns. Example messages are discarded. A playbook that had example messages gets a new `updated_at`, because its embedded text changes, so the drift repair job embeds it again.

## Consequences

- The API, the MCP tools and the form lose the fields `response`, `examples` and `restrictions`. Clients that send them get a validation error.
- Retrieval no longer sees example phrasings. A playbook is found by its topic and its information, so a topic or an information text that avoids the words that senders use may be found less often. The retrieval evals measure this.
- A user can set one tone for every reply and override it for a topic without a second system.
- Decisions 0042 and 0043 leave the storage of reply instructions open. This decision stores them as the default instruction in the profile, and the optional input of the pipeline is filled from it.
- There is still no separate store of base knowledge that is not tied to a period and conditions. A later decision can add one if playbooks prove to be the wrong unit.
