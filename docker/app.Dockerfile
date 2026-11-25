# The image of the API and the worker. Both run from TypeScript source with tsx (decision 0015), so
# one image serves both and the container command selects the process. Development dependencies
# stay installed because the database migration runs drizzle-kit from the same image.
FROM node:24-slim

RUN corepack enable

WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app

USER node
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@leren/api", "start"]
