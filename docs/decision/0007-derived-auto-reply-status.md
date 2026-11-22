# 0007. Auto-reply status is derived, not stored

- Status: Superseded
- Date: 2026-11-19
- Affects: packages/db, apps/api, apps/worker, apps/platform, docs/overview/README.md
- Superseded by: [0019](0019-email-reply-conditions.md)

## Context

The original product idea centred on a vacation with a stored lifecycle status and jobs that activate and deactivate it. The product is more general than vacations, and stored statuses can drift from the clock.

## Decision

Model the concept as an auto-reply rule with an `enabled` flag, an optional `starts_at`, an optional `ends_at` and a timezone. Compute the status (`disabled`, `scheduled`, `active`, `expired`) with a pure function of the rule and the current time. Do not store the status and do not run activation jobs. The gate that decides whether an email is handled is deterministic code that uses this function. The agent does not decide it.

## Consequences

- The status can never be stale.
- Queries that need active rules filter on `enabled` and the date columns.
- Reports for an ended rule are computed when read.
