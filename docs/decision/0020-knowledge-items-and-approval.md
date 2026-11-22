# 0020. Knowledge items and approval

- Status: Superseded
- Date: 2026-11-20
- Affects: packages/db, packages/knowledge, apps/api, apps/platform, docs/overview/README.md, docs/rules/packages.md
- Superseded by: [0035](0035-playbooks.md)

## Context

The Reply Agent may only reply from knowledge that the user has approved and that is valid at the time of the email. The same rule is needed by the API, which lists knowledge, by the indexing job, which decides what to put in Qdrant, and by retrieval, which filters results. Apps may not import each other, so the rule must live in a package.

Knowledge belongs to an auto-reply rule, and a reply may name a person to contact, such as the owner of a project.

## Decision

- Store knowledge in `knowledge_items`. Each item belongs to a user and to one auto-reply rule and has a topic, a response, optional examples, restrictions, an optional validity window and an approval status of `draft`, `approved` or `archived`. The user id is repeated on the item so that every query can filter by user without a join.
- Store the people that a reply may point to in `contacts`, a list of text on the item. Each entry is an email address or a channel handle such as `@Don`. The list belongs to the item and so to its rule, and it is not a record tied to a user with a name and a role.
- Add the `@leren/knowledge` package with the pure function `isKnowledgeUsable(item, now)`. An item is usable only when it is approved and `now` is inside its validity window, with inclusive bounds and open missing bounds. The API, the indexing job and retrieval all call this function.
- The approval status changes only through the approve, archive and restore actions of the API. A request that creates or replaces an item cannot set it. A new item is a draft. Approving applies to a draft, archiving applies to a draft or an approved item, and restoring returns an archived item to draft so that it is approved again.
- Editing an approved item returns it to draft. The approved text is the text that was reviewed, so a changed text needs a new review.
- The rule that an item references must belong to the same user. A reference to the rule of another user is rejected with the same error as a missing one.

- A knowledge item is basic knowledge about a topic, not a question and answer pair, because incoming email is often a statement or a request and not a question. The `response` is what the assistant may say. The `examples` are optional sample messages in any phrasing, which indexing embeds together with the topic and the response to improve retrieval.

## Consequences

- An agent that can only propose edits cannot make its own proposal usable, because approval is a separate action by the user (decision 0006).
- A user who fixes a typo in an approved item must approve it again, and the item is not usable in between.
- Deleting a rule deletes its knowledge items and their contacts.
- Indexing must remove the vector of an item when it leaves the approved state or its window ends, because the status changes without a request from the indexer.
