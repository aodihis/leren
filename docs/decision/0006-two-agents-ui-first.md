# 0006. Two separate agents, with the UI as the primary interface

- Status: Accepted
- Date: 2026-11-19
- Affects: packages/agents, apps/api, apps/worker, apps/platform, docs/overview/README.md

## Context

The system needs an AI helper for the person configuring it and an AI pipeline that handles incoming email. These have different inputs, trust levels and risks.

## Decision

Build two agents with separate prompts, tool sets and sessions.

- The Assistant Agent helps the user look up saved data, generate example questions and refine information. It only creates proposals, which the user accepts in the UI. The UI is the primary way to manage data and works without the assistant.
- The Reply Agent runs in the worker for one queued email. It treats email content as untrusted data, is limited to 5 steps and can only produce a draft or a decision record. It cannot send or approve.

Both use Anvia as the agent framework, and both reach data only through the MCP server.

## Consequences

- A prompt injection in an email cannot reach the Assistant Agent's tools.
- Each agent has its own evaluation and tracing.
- Two agents mean two sets of prompts and tools to maintain.
