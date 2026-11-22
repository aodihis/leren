# 0014. Email package over SMTP with Mailpit for development

- Status: Accepted
- Date: 2026-11-20
- Affects: packages/email, apps/api, docker-compose.dev.yml, docs/rules/packages.md, docs/rules/general.md, docs/overview/README.md

## Context

Sign-in codes ([0013](0013-better-auth-email-code.md)) and later notifications need outgoing email. The provider is not chosen yet, and developers must read the emails without a real mailbox.

## Decision

Add `@leren/email` with an `EmailSender` interface, an SMTP implementation built on Nodemailer, a verification code template and an in-memory sender in `@leren/email/testing`. SMTP is accepted by nearly every provider, so changing provider means changing `SMTP_URL`. A provider with an HTTP API can be added as another `EmailSender` without changing callers.

Development uses Mailpit, which accepts any SMTP message and shows it in a web inbox. It runs from `docker-compose.dev.yml` with SMTP on port 51025 and the inbox on port 58025. The compose file is renamed from `docker-compose.yml` to mark it as development only. Earlier decisions that mention `docker-compose.yml` refer to this file.

## Consequences

- Production needs an SMTP account and `SMTP_URL` and `EMAIL_FROM` set.
- Tests assert on sent messages with the in-memory sender and never open a connection.
- Commands that start the services use `pnpm services:up` or `docker compose -f docker-compose.dev.yml up -d`.
