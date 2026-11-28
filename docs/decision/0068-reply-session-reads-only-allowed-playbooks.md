# 0068. A reply session reads only the playbooks that the gate allowed

- Status: Accepted
- Date: 2026-11-28
- Affects: packages/mcp-server, packages/knowledge, packages/vector-db, packages/db, apps/worker, packages/reply-agent

## Context

The email gate decides deterministically which playbooks may answer a message, from their reply conditions such as the sender allowlist. The answering agent then searches the playbooks through the MCP server (decision 0066). Its search returned every usable playbook of the user, and the pipeline dropped the playbooks outside the gate's set only after the run. The model could therefore read a playbook meant for another sender, such as a deadline with another date, and use its facts while citing an allowed playbook. A citation check cannot see where a fact came from.

## Decision

- A reply session stores the ids of the playbooks that the gate allowed for its message. They are required when a reply session is minted and rejected for every other role.
- `search_playbooks`, `get_playbook`, `list_playbooks` and the playbook resource return only those playbooks in a reply session. Any other playbook is reported as not found.
- The ids are stored in the session row, so the model cannot change them. They never appear in a prompt or a tool argument.
- The pipeline keeps its own filter on the allowed ids as a second check.

## Consequences

- The answering agent never sees a playbook whose conditions exclude the sender, so it cannot mix its facts into a reply.
- The search applies the filter inside the vector index, so the other playbooks of the user never push an allowed playbook out of the candidates. The vector store's filter accepts a list of values for this.
- The drafter evals apply the same filter to their fake tools, so they test what production does.
