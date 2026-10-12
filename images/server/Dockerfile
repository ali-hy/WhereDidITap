# syntax=docker/dockerfile:1
# The server image (api, workers, migrate, cli): F-24's esbuild bundle with the server's own
# production dependencies (A-43). Build context: the repository root (A-393).
#   docker build -f images/server/Dockerfile -t budmon/server:<tag> .
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @budmon/server... \
 && pnpm --filter @budmon/server build \
 && pnpm --filter @budmon/server deploy --prod --legacy /deploy \
 && mkdir /out \
 && cp -R /deploy/package.json /deploy/node_modules apps/server/dist apps/server/drizzle /out/

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/ /app/
# Compose sets the per-service UID (F-175); the files stay root-owned and read-only to it.
USER 10001:10001
CMD ["node", "--import", "./dist/main/instrument.js", "dist/main/api.js"]
