# 0013. Better Auth with emailed one-time codes

- Status: Accepted
- Date: 2026-11-20
- Affects: apps/api, apps/platform, packages/db, docs/overview/README.md, docs/rules/backend.md

## Context

Users must sign in before they can own rules and knowledge. Passwords add reset flows, strength rules and credential storage that the product does not need. Every user already has an email address, and the product is built around email.

## Decision

Use Better Auth with its `emailOTP` plugin and the Drizzle adapter on `@leren/db`. Registration and sign-in are one flow: the user enters an email address, receives a six-digit code and submits it. An unknown address becomes a new user when its code is verified. There are no passwords. Codes expire after ten minutes and allow three attempts.

The tables are `users`, `sessions`, `accounts` and `verifications`, with UUID primary keys. `users` keeps `first_name` and `last_name` as additional fields and derives Better Auth's required `name` from them. Sessions are cookies. The API mounts Better Auth under `/api/auth` and exposes the `requireUser` middleware, which sets `userId` on the Hono context. The platform calls the API through a same-origin `/api` path, proxied by Vite in development.

The code email is sent without awaiting delivery, so response time does not reveal whether an address can receive mail. Delivery goes straight to the email sender and not through the queue.

## Consequences

- Anyone who controls an inbox can create an account. There is no separate registration step or approval.
- Sign-in depends on email delivery, so the SMTP provider is a runtime dependency of the API.
- Every query for user data must be scoped by the `userId` that the middleware sets.
- The platform and API must be served from one origin in production, or the API must be configured for cross-origin cookies.
