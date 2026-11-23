# 0044. An enabled playbook must name a channel account

- Status: Accepted
- Date: 2026-11-23
- Affects: apps/api, apps/platform, packages/mcp-server, packages/assistant-agent, prompts/assistant.md, docs/overview/README.md, docs/plans/0001-auto-reply-roadmap.md

## Context

[0038](0038-channel-providers-and-google-oauth.md) lets the conditions of a playbook name the channel account that it listens on, and says that a null or absent account means none. The gate of [0039](0039-email-record-reply-mode-and-gate.md) takes only the playbooks whose conditions name the account that the message arrived on. A playbook without an account is therefore never used for any email, and the message ends as `not_applicable`.

The API accepts such a playbook without a complaint, so nothing tells the user. This happens in the assistant chat. The tool that creates a playbook does not accept a channel account, so every playbook that it creates has none. The chat reports success, and the playbook never handles an email. The assistant prompt does not mention accounts either.

## Decision

- A playbook that is enabled and has conditions for a channel must name a channel account of its owner on that channel. The API rejects a request that creates, replaces or enables such a playbook without one, with an error that says that a mailbox is needed. The rule is in the schema and the service that the web API and the MCP write tools share, so every path gets the same rule and the same message.
- The account must be **active** when the playbook is created or turned on. When an enabled playbook is replaced, the account must exist, belong to the owner and be on the channel, and it may be revoked. A user can therefore still edit or rename an enabled playbook whose account was revoked, for example when the token of a test account expires. The playbook list marks such a playbook as having no mailbox until the account is connected again or another one is chosen.
- A disabled playbook may have no account, so that a playbook can be saved before the user connects a mailbox.
- The tools of the Assistant Agent that create and change a playbook accept the channel account in the conditions. When the request does not name one, the tool uses the owner's only active account on the channel. When the owner has none or has several, the tool returns the error, and for several accounts it lists the id and the label of each, so that the assistant can ask the user which one to use. The listing holds only the owner's own accounts and no credentials, so it needs no new scope.
- The assistant prompt says that a playbook needs a mailbox and that the assistant confirms which one with the user before it saves, whenever the user has more than one.
- Playbooks that exist without an account are not migrated. They keep working as they are saved, which means that they handle nothing. They cannot be saved while enabled until the user chooses an account. The playbook list marks them as having no mailbox, so that the user sees why they do nothing.
- The assistant evaluation gets cases for a playbook that is created with the only account, one that needs a choice between accounts, and one with no account connected.

## Consequences

- A playbook that the assistant creates is the same as one that the web form creates, and it can handle email.
- A user who has not connected a mailbox cannot enable a playbook. The assistant tells them to connect one first.
- A user with a second account on the channel, if a later decision allows it, is asked which one to use.
- The decision narrows the meaning of "none" in decision 0038 to disabled playbooks. It does not change the table, and the gate stays as it is.
- The API enforces the rule when a playbook is created, replaced or turned on, and the web form, the assistant tools and the playbook list follow it.
