#!/usr/bin/env bash
# F-170 first setup (run once by the upstream entrypoint, on the socket-only temporary server):
# the cluster bootstrap (F-14's statements as psql) with the migrator's SCRAM verifier, read from
# its secret file into the environment only (A-75), never into arguments.
set -euo pipefail
BUDMON_MIGRATOR_PASSWORD="$(cat /run/secrets/MIGRATOR_VERIFIER)"
export BUDMON_MIGRATOR_PASSWORD
psql -v ON_ERROR_STOP=1 --no-psqlrc -U "${POSTGRES_USER}" -d postgres -v dbname=budmon \
  -f /docker-entrypoint-initdb.d/10-budmon.sql.tpl
unset BUDMON_MIGRATOR_PASSWORD
