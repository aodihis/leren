# 0026. Vendor-neutral entry point of the embedder package

- Status: Accepted
- Date: 2026-11-21
- Affects: packages/embedder, apps/worker

## Context

[0024](0024-embedder-and-knowledge-indexing.md) adds `@leren/embedder` with an implementation for OpenAI-compatible endpoints. The package exported that implementation under a vendor name, so every caller that imported it was tied to the vendor and a replacement would change each of them.

## Decision

- The package exports `createEmbedder`, `EmbedderOptions` and the `Embedder` interface. No exported name contains a vendor name.
- `createEmbedder` delegates to the OpenAI-compatible implementation. That implementation is internal to the package and is not exported.
- `EmbedderOptions` holds the endpoint, key, model and dimensions, which every provider needs.

## Consequences

- Replacing the provider changes `createEmbedder` and the package internals only. Applications keep their imports.
- A provider that needs other settings requires extending `EmbedderOptions`.
