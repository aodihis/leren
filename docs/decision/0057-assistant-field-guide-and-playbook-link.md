# 0057. The MCP server describes the playbook fields, and a saved playbook carries its link

- Status: Accepted
- Date: 2026-11-26
- Affects: packages/mcp-server, packages/assistant-agent, apps/api, prompts/assistant.md

## Context

The assistant prompt described the fields of a playbook, which of them are required and how to gather them. The prompt and the schema that validates a playbook could therefore disagree, and every new field needed a change in both. The assistant also confirmed a save without a way for the user to open what was saved.

## Decision

- The MCP server has a read tool, `describe_playbook_fields`. It returns each field of a playbook and of its email conditions with its type, whether it is required, its default and a description. The API builds the answer from the same schema that validates a write and passes it to `@leren/mcp-server`, so the tool cannot disagree with what `create_playbook` accepts. The tool needs the `playbooks:read` scope and is on the allowed list of the Assistant Agent only.
- The descriptions of the fields live in the schema of the API. The prompt names no field values and refers to the tool.
- The result of `create_playbook` and `update_playbook` carries `url`, the page of the playbook in the web application at `PLATFORM_URL`. The assistant answers a save with the topic as a link to it.
- The assistant asks only for the required fields that are missing, as a bulleted list, and shows the defaults in the confirmation instead of asking about them. It answers a question about how to create a playbook with every field from the tool.

## Consequences

- A new field of a playbook appears in the assistant's guidance when its schema entry has a description, with no change to the prompt.
- The evals use a fake `describe_playbook_fields` and a fake link that match the real tool surface.
- A deployment that does not give `platformUrl` to the MCP endpoint returns saved playbooks without a link, and the assistant names the topic only.
