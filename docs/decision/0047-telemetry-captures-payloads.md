# 0047. Telemetry captures prompts, replies and stage payloads

- Status: Accepted
- Date: 2026-11-23
- Affects: packages/observability, docs/overview/README.md

## Context

[0010](0010-anvia-agents-and-vendor-neutral-observability.md) says that Lens runs in the safe capture mode, so that prompt and response bodies are not exported. In that mode a trace of the reply pipeline shows the stages, their timing and their errors, and it does not show the email that went in, the playbooks that were found, the draft that came out or the verdict of the judge. A failed or wrong run cannot be understood from it, and the person who debugs it has to reproduce the run.

## Decision

- The observer exports with the capture mode `full`. A trace holds the prompts and the answers of the model calls, the arguments and results of the MCP tool calls, and the input and output of each stage of a pipeline. The mode is fixed in the code of `packages/observability` and has no environment variable.
- The redaction patterns of the library keep applying to what is exported. Credentials and tokens are never put in a prompt, and the session token is sent in a header, so it is not part of a payload.
- This changes the statement of decision 0010 about the capture mode. The rest of 0010 stays in force.

## Consequences

- The text of the emails that the assistant reads, and of the replies that it writes, is stored on the Lens server. The Lens server must be run where that is acceptable, and access to it is access to that text.
- A person who debugs a message can open its trace and read what each stage received and returned.
- The overview no longer says that bodies are not exported.
- A deployment that needs the safe mode again has to change the code, and a later decision can add a setting.
