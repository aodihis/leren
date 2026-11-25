# Package rules

Applies to everything in `packages/`.

- Name packages `@leren/<name>`.
- Packages are source-only: `exports` points at the TypeScript entry file and there is no build step.
- Consume them from apps with `"@leren/<name>": "workspace:*"`.
- Each package exposes its public API from `src/index.ts`. Do not import deep paths from another package. Test-only helpers live in a separate entry point, such as `@leren/db/testing` or `@leren/agents/testing`, so production code does not import them.
- Packages never import from `apps/*`.
- Each package has a `typecheck` script.
- `@leren/ui` lists `react` as a peer dependency. Other packages should avoid framework dependencies unless that is their purpose.
- `@leren/ui` holds shadcn/ui components, which are excluded from the linter and formatter. See [0004](../decision/0004-shadcn-in-ui-package.md).

## Current packages

| Package                  | Purpose                       |
| ------------------------ | ----------------------------- |
| `@leren/agents`          | Shared agent runtime          |
| `@leren/assistant-agent` | Assistant Agent               |
| `@leren/reply-agent`     | Reply Agent                   |
| `@leren/plugin-client`   | Plugin manifest and loader    |
| `@leren/ui`              | Shared React components       |
| `@leren/observability`   | Logging and tracing           |
| `@leren/db`              | Database client and schema    |
| `@leren/vector-db`       | Vector store abstraction      |
| `@leren/embedder`        | Text embedding provider       |
| `@leren/queue`           | RabbitMQ queues and retries   |
| `@leren/rate-limit`      | Per-key rate limits on Redis  |
| `@leren/mcp-server`      | MCP server and sessions       |
| `@leren/logger`          | Library-agnostic logging      |
| `@leren/email`           | Email sending over SMTP       |
| `@leren/auto-reply`      | Period status and conditions  |
| `@leren/knowledge`       | Playbook usability, retrieval |
| `@leren/inbox`           | Message records and statuses  |
| `@leren/channels`        | Channel providers and tokens  |
| `@leren/evals`           | Shared eval runner and gate   |

## Observability

Applications and packages use `Observer` from `@leren/observability` and never import a tracing backend. See [0010](../decision/0010-anvia-agents-and-vendor-neutral-observability.md).
