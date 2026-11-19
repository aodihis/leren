# Review lenses

Each lens is a separate pass over the diff. Report only what the changed code actually does. A checklist item is a prompt to look, not a finding.

## Security

- Untrusted input reaching a query, shell command, file path, URL, template or `eval`-like sink without validation or parameterization.
- Missing or wrong authentication and authorization, including checks that depend on client-supplied identifiers or tenant IDs.
- Secrets, tokens or personal data in code, logs, error messages, responses or URLs.
- Unsafe deserialization, open redirects, SSRF, path traversal, and overly permissive CORS.
- Prompts that include untrusted content with tool access, and model output used as a command or query without validation.
- New dependencies or version changes with known problems.

## Correctness

- Logic that does not match the stated intent, the types, or the product docs in `docs/product/`.
- Off-by-one errors, wrong operators, inverted conditions, and unhandled `null`, `undefined`, empty or duplicate values.
- Async mistakes: missing `await`, unhandled rejections, races between reads and writes, and results used before they resolve.
- Changed behavior that callers or tests still assume. Search for callers.
- Error paths that swallow errors, return success after a failure, or leave partial state.
- Tests that do not assert the behavior they claim to cover, and changed behavior without a test.

## Performance

- Queries or calls inside loops (N+1), missing indexes for new query patterns, and unbounded result sets.
- Work on the request path in `apps/api` that belongs in a `apps/worker` job, per `docs/rules/architecture.md`.
- Repeated computation, needless re-renders, and large payloads or bundles introduced by the change.
- Sequential awaits that could run in parallel, and parallelism with no concurrency limit.
- Unbounded memory growth, such as caches without eviction and buffering whole streams.

Report a performance finding only when the cost scales with input size or traffic. Do not micro-optimize.

## Maintainability

- Violations of `docs/rules/` and accepted decisions in `docs/decision/`, including module boundaries and cross-app imports.
- Code placed in the wrong layer, package or module.
- Names that mislead, duplicated logic that should share one implementation, and functions that do several unrelated things.
- Comments that break the repository comment rules: inline comments, comments that narrate changes, or comments that restate the code.
- Public behavior or configuration that changed without the matching update in `docs/overview/`.

## Reliability and resilience

- Calls to the database, Qdrant, queues or model providers without a timeout, and retries without backoff, a limit, or idempotency.
- Jobs in `apps/worker` that are not safe to run twice, or that lose work on a crash.
- Failures that cascade: one dependency being down takes unrelated paths down with it.
- Missing cleanup of connections, handles, listeners and timers, and shutdown that drops in-flight work.
- Errors that are not logged with enough context, and metrics or traces missing for new failure modes.
- Migrations that are not backward compatible with the running version, or that lock large tables.
- Configuration that has no safe default or fails late instead of at startup.

## Simplification pass

Behavior-preserving cleanups on the changed code only.

- **Reuse:** an existing helper, package export or workspace dependency already does this.
- **Dead code:** unused exports, parameters, branches, flags and imports introduced or exposed by the change.
- **Needless abstraction:** a wrapper, option, generic or layer with a single use.
- **Redundant state:** state that can be derived from other state, and duplicated sources of truth.
- **Control flow:** deep nesting that early returns would flatten, and conditions that can be merged.
- **Efficiency:** adjacent passes over the same array that can be one pass, subject to the lint rules.

Do not simplify in a way that changes behavior, widens the diff beyond the changed code, or conflicts with a rule in `tooling/oxlint/`.
