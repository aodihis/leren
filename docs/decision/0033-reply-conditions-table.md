# 0033. One reply conditions table with a channel

- Status: Accepted
- Date: 2026-11-21
- Affects: packages/db, packages/auto-reply, apps/api, apps/platform, packages/assistant-agent, docs/plans/0001-auto-reply-roadmap.md

## Context

[0019](0019-email-reply-conditions.md) stores the conditions of each channel in a table of its own, `email_reply_conditions` first and a sibling table for every channel after it. [0021](0021-channels-and-channel-accounts.md) says that a rule listens on a channel when it has a conditions row for that channel. The assistant and the API need a shape that does not name one channel, so that adding Slack or another channel does not change the rule API, the tools or the tables.

## Decision

- Store the conditions of every channel in one table, `reply_conditions`, with the rule, a `channel` and a `settings` JSON object. The pair of rule and channel is unique, so a rule has at most one row for each channel, and a rule listens on a channel when the row exists.
- `channel` is text and not a database enum, so a new channel needs no migration. The first value is `email`.
- The shape of `settings` is defined for each channel as a schema. The API validates every write against the schema of the channel, and a channel that has no schema is rejected. The email settings keep their current fields: `senderMode`, `senderAllowlist`, `replyWhenTo`, `replyWhenCc`, `replyWhenBcc`, `requireSoleRecipient`, `mentionOverrides`, `mentionDetection`, `mentionAliases`, `threadMode` and `skipBulkMail`.
- The rule API names the conditions `conditions`, an array with one entry for each channel. Each entry has a `channel` and the settings of that channel at the same level, and an update replaces the whole array. A rule needs at least one entry and may not repeat a channel. The assistant's rule tools use the same shape and merge the entries that they name into the stored ones.
- The `channel_account_id` column that 0021 adds to each conditions table is one nullable column on `reply_conditions`.
- Migration `0007_reply_conditions` copies every `email_reply_conditions` row to a `reply_conditions` row with the channel `email`, and `0008_drop_email_reply_conditions` drops the old table and its enums.

## Consequences

- Adding a channel is a new settings schema and a new evaluation function. It needs no new table and no migration.
- The database no longer types the settings, so a schema in code is the only guard on them. Reading a row relies on it having been validated when it was written.
- Settings cannot be indexed or constrained column by column without a JSON expression.
- The rule API breaks: `email` became an entry of `conditions`. The web form still edits the email channel and converts to and from that shape.
- 0019 is superseded by this decision. Its other points stand and are not repeated here: `auto_reply_rules` stays channel-agnostic, the status is derived, and the gate is deterministic code in `@leren/auto-reply`. In 0021, "a table of its own" now reads as the `reply_conditions` row of that channel.
