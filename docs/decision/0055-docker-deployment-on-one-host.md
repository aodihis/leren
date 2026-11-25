# 0055. Docker deployment on one host

- Status: Accepted
- Date: 2026-11-25
- Affects: docker/, docker-compose.prod.yml, .github/workflows/deploy.yml, .env.example

## Context

The platform calls the API with relative URLs, and the session cookie, the OAuth callbacks at `${API_URL}/api/...` and the MCP endpoint at `/mcp` all assume that the platform and the API share an origin. The API and the worker run from TypeScript source ([0015](0015-api-runs-from-source.md), [0012](0012-worker-module-driven-structure.md)), and the worker roles are independent of the API ([0045](0045-worker-roles.md)).

## Decision

- The deployment uses one host name. The reverse proxy sends `/api` and `/mcp` to the API and every other path to the platform, which is the Vite build served by nginx.
- The API and the worker are separate containers started from one image, `docker/app.Dockerfile`, and the container command selects the process. The platform has its own image, `docker/platform.Dockerfile`.
- PostgreSQL, RabbitMQ, Redis and Qdrant are shared services outside the stack, reached on the shared network.
- A push to `main` builds and pushes the images to GHCR, writes the `.env` file of the stack from the repository's variables and secrets, runs `pnpm --filter @leren/db db:migrate` in the API image, and then starts the stack.

## Consequences

- No CORS configuration or cross-site cookies are needed.
- The worker can be scaled or split by role without a change to the API container.
- A new environment variable must be added to the `deploy.yml` list to reach the containers.
- The images run `tsx` on the source, so they include the development dependencies.
