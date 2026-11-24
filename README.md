# Leren

Leren is an AI email assistant for people whose inbox fills up while they are away or busy. You write **playbooks**: short notes that say what the assistant may tell people and when it may reply. Leren reads your incoming work email, answers what a playbook covers, and leaves everything else to you.

## How it works

1. **Connect a mailbox.** Sign in with an email code and connect your Gmail account.
2. **Write playbooks.** A playbook has a topic, the response the assistant may give, optional example messages and restrictions on what must not be said. Rules choose the period it is active, which senders it answers and whether it answers new threads, replies or both.
3. **Leren handles the mail.** Each new email is checked against your rules, classified, and matched to the playbooks that cover it. The reply is written only from your playbooks, so it does not invent facts.
4. **You stay in control.** By default the reply is saved as a draft in your own mailbox, in the right thread, and you edit and send it. A playbook can instead send replies on its own. An email that no playbook covers is escalated to you with the reason.

The dashboard shows what was answered, escalated or ignored, and how each playbook performs. An optional assistant chat can look up, suggest and edit playbooks for you, but it cannot send mail or change a reply mode.

## What keeps it safe

- The assistant answers only from enabled playbooks that are inside their period.
- Prompt injections in an email are treated as text, never as instructions.
- Replies are drafts unless you turn on sending for a playbook.
- Every agent is tested with evaluation suites that must pass before a change ships (`pnpm run evals`).

## Built with

| Part       | Role                                                       |
| ---------- | ---------------------------------------------------------- |
| `platform` | React web app: playbooks, message log, dashboard, chat     |
| `api`      | Hono API with OpenAPI docs and an MCP server for the agent |
| `worker`   | Queue consumers: email listener, pipeline, reply delivery  |
| Infra      | PostgreSQL, Qdrant, RabbitMQ, Anvia agents and Lens traces |

Read the [high-level design](docs/overview/README.md) and the [decisions](docs/README.md) for details.

## Run it

You need Node.js 20+, pnpm 11 and Podman with a Compose provider.

```sh
cp .env.example .env   # set BETTER_AUTH_SECRET, RABBITMQ_URL, EMBEDDING_API_KEY
pnpm install
pnpm services:up       # PostgreSQL, Qdrant, RabbitMQ, Mailpit
pnpm --filter @leren/db db:migrate
pnpm --filter @leren/api dev
pnpm --filter @leren/platform dev
pnpm --filter @leren/worker dev
```

- Sign-in codes arrive in Mailpit at http://localhost:58025.
- API reference (Scalar): http://localhost:3000/scalar. The raw OpenAPI document is at `/openapi.json`.
- Checks: `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`.
- To keep `.env` encrypted, run `pnpm env:encrypt` and use the `*:secure` scripts.
