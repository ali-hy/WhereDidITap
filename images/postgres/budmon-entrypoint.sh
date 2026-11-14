#!/usr/bin/env bash
# F-170: the Postgres image's entrypoint. Refuses to start without the data mount, refuses to
# initialise an empty data directory unless BUDMON_FIRST_SETUP=1, and always starts Postgres with
# the mounted configuration files (/etc/budmon, read-only).
#   budmon-entrypoint.sh postgres [args]
set -euo pipefail

readonly DATA_MOUNT=/var/lib/postgresql/data

if [ "${PGDATA:-}" != "${DATA_MOUNT}/pgdata" ]; then
  echo "Refusing to start: PGDATA must be ${DATA_MOUNT}/pgdata" >&2
  exit 70
fi
if ! mountpoint -q "${DATA_MOUNT}"; then
  echo "Refusing to start: data mount missing" >&2
  exit 70
fi

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  if [ "${BUDMON_FIRST_SETUP:-0}" != "1" ]; then
    echo "Refusing to initialise an empty data directory without BUDMON_FIRST_SETUP=1" >&2
    exit 70
  fi
  # The upstream entrypoint's initialisation; 10-budmon.sh then runs the cluster bootstrap.
  export POSTGRES_USER=budmon_admin
  export POSTGRES_PASSWORD_FILE=/run/secrets/ADMIN_PASSWORD
  export POSTGRES_DB=postgres
fi

if [ "${1:-postgres}" = "postgres" ]; then
  [ "$#" -gt 0 ] && shift
  set -- postgres \
    -c config_file=/etc/budmon/postgresql.conf \
    -c hba_file=/etc/budmon/pg_hba.conf \
    -c ident_file=/etc/budmon/pg_ident.conf \
    -c "listen_addresses=${BUDMON_LISTEN_ADDRESSES:-}" \
    "$@"
fi
exec docker-entrypoint.sh "$@"
