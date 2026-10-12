# syntax=docker/dockerfile:1
# The web image: the built SPA (F-221, version.json) served by Caddy with infra/local/Caddyfile
# (F-175). Build context: the repository root (A-393).
#   docker build -f images/web/Dockerfile --build-arg BUDMON_BUILD_NUMBER=<n> -t budmon/web:<tag> .
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
ARG BUDMON_BUILD_NUMBER=0
# A-370: the web Sentry DSN is a build argument (optional; no DSN leaves Sentry off).
ARG VITE_SENTRY_DSN=
RUN pnpm install --frozen-lockfile --filter @budmon/web... \
 && BUDMON_BUILD_NUMBER="${BUDMON_BUILD_NUMBER}" VITE_SENTRY_DSN="${VITE_SENTRY_DSN}" \
    pnpm --filter @budmon/web build

FROM caddy:2.11.7@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772
# Caddy runs as an unprivileged UID with a read-only root (F-175): its state goes to /tmp.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
# The base image gives caddy the bind-to-low-ports file capability; with cap_drop ALL and
# no-new-privileges (F-175) such a binary can't be executed, and :8080 doesn't need it.
RUN setcap -r /usr/bin/caddy
COPY --from=build /repo/apps/web/dist/ /srv/web/
COPY infra/local/Caddyfile /etc/caddy/Caddyfile
# The Caddyfile's `@maint file /srv/maintenance/on` resolves against the working directory.
WORKDIR /
USER 10005:10005
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
