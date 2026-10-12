# syntax=docker/dockerfile:1
# The Postgres image (F-170). Its base is the integration tests' POSTGRES_IMAGE exactly (A-61,
# TP-15.30). Build context: this directory, plus the named context `sql` for the cluster-bootstrap
# script (A-393):
#   docker build --build-context sql=apps/server/src/platform/db/sql \
#     -t budmon/postgres:<tag> images/postgres
FROM postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336

# pgbackrest from PGDG, pinned. Unused on the laptop, installed so the image is the same in
# stages 0 and 1 (D-29 rule 1).
ARG PGBACKREST_VERSION
RUN test -n "${PGBACKREST_VERSION}" || { echo "PGBACKREST_VERSION is not pinned" >&2; exit 1; } \
 && apt-get update \
 && apt-get install -y --no-install-recommends "pgbackrest=${PGBACKREST_VERSION}" \
 && rm -rf /var/lib/apt/lists/*

COPY --from=sql cluster-bootstrap.sql /docker-entrypoint-initdb.d/10-budmon.sql.tpl
COPY 10-budmon.sh /docker-entrypoint-initdb.d/10-budmon.sh
COPY budmon-entrypoint.sh /usr/local/bin/budmon-entrypoint.sh

ENV PGDATA=/var/lib/postgresql/data/pgdata
# `psql -U budmon_admin` over the socket lands in the always-present postgres database.
ENV PGDATABASE=postgres
USER postgres
ENTRYPOINT ["budmon-entrypoint.sh"]
CMD ["postgres"]
