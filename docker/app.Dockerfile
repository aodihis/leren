# The image of the API and the worker (decision 0056). The first stage builds the bundles and the
# second stage copies only the build output, so the image holds no source, no development
# dependencies and no `node_modules`. The container command selects the process: `dist/api.js`,
# `dist/worker.js` or, for a one-off run, `dist/migrate.js`.
FROM node:24-slim AS build

RUN corepack enable

WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app

USER node
RUN pnpm install --frozen-lockfile
RUN pnpm build:app

FROM node:24-slim

WORKDIR /app
COPY --from=build --chown=node:node /app/out ./

ENV NODE_ENV=production
ENV HARNESS_CONFIG=/app/harness.config.js

USER node
CMD ["node", "dist/api.js"]
