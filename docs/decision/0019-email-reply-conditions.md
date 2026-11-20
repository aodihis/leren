# 0019. Channel-specific reply conditions and the auto-reply package

- Status: Accepted
- Date: 2026-11-20
- Affects: packages/db, packages/auto-reply, apps/api, apps/worker, apps/platform, docs/overview/README.md, docs/rules/packages.md

## Context

An auto-reply rule decides when the assistant is active. Users also need to say which messages it answers: from whom, in which recipient role, whether the user is the only recipient, whether the user is addressed by name and whether the message belongs to a thread. These conditions depend on the channel, and a channel such as Slack will be added later. Both the API, which shows the derived status, and the worker gate need the same evaluation code, and apps may not import each other.

[0007](0007-derived-auto-reply-status.md) states that the gate is deterministic code and that the agent does not decide whether an email is handled. Detecting that a message is addressed to the user by name cannot always be done by matching text, for example when a nickname or a pronoun is used.

## Decision

- Keep `auto_reply_rules` channel-agnostic: user, name, enabled, `starts_at`, `ends_at` and timezone. `name` is a label for the user and is never read by the gate. The status stays a pure function of the rule and the current time and is never stored, as decided in 0007.
- Store the conditions of each channel in a table of its own that references the rule. The first is `email_reply_conditions`, with one row per rule. A channel added later gets a sibling table and does not change `auto_reply_rules`.
- Add the `@leren/auto-reply` package. It has no dependencies and exports `getAutoReplyStatus` and the email condition evaluation. Both functions are pure, take already parsed facts and not raw messages, and return a verdict with a reason.
- Recipient role is derived from the headers. The user is a Blind Carbon Copy recipient when the user's address is in neither the To nor the Cc header.
- Mention detection has two modes. `alias` matches the user's name and configured aliases as whole words, ignoring case, and is deterministic. `alias_then_llm` tries `alias` first and asks a model only when it does not match. The model call is made by the gate, never by the `@leren/auto-reply` package, and it can only answer whether the message is addressed to the user. It cannot choose a reply, and the email content is treated as untrusted data.
- All other conditions are deterministic. Whether a message is handled outside an active rule is never decided by a model.

## Consequences

- 0007 is superseded. Its derived status rule is unchanged and is restated here. Only its statement that no model takes part in the gate is relaxed, and only for mention detection when the rule opts in.
- A rule that uses `alias_then_llm` costs one model call for each message that passes the other conditions and has no alias match.
- The gate can record the reason for each verdict, so the user can see why a message was or was not handled.
- Adding Slack needs a new conditions table and a new evaluation function, not a change to the rule or the status.
