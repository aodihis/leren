# The image of the platform: the Vite build served by nginx. The platform calls the API with relative
# URLs, so the build needs no address and the reverse proxy sends `/api` and `/mcp` to the API.
FROM node:24-slim AS build

RUN corepack enable

WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app

USER node
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @leren/platform build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/platform/dist /usr/share/nginx/html
EXPOSE 80
