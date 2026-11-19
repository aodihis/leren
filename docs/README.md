# Docs

| Folder                  | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| [`decision/`](decision) | Engineering decisions (ADRs): what we chose, why, and what it affects.              |
| [`product/`](product)   | Product decisions: scope, behaviour and priorities.                                 |
| [`rules/`](rules)       | Constraints and guides for working in this codebase.                                |
| [`overview/`](overview) | User-facing documentation, including the high-level design in `overview/README.md`. |

## Decision records

Files are named `NNNN-meaningful-name.md`, numbered in order and never reused.

### Status

| Status       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `Accepted`   | The decision is in force.                                      |
| `Rejected`   | The option was considered and not adopted. Kept to record why. |
| `Deprecated` | Was accepted, no longer recommended, but not replaced.         |
| `Superseded` | Replaced by a newer decision. Link to it with `Superseded by`. |

### Template

```md
# NNNN. Title

- Status: Accepted | Rejected | Deprecated | Superseded
- Date: YYYY-MM-DD
- Affects: apps/api, packages/db
- Superseded by: (only when status is Superseded)

## Context

## Decision

## Consequences
```

`Affects` lists the apps, packages, tooling or docs touched by the decision.
