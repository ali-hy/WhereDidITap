#!/usr/bin/env bash
# TP-2.18 (S-2, A-55, A-63, A-73): from a fresh clone (no .env), `pnpm dev` creates .env from
# .env.example, creates .data/dev-secrets/*, starts Postgres, and creates and pushes database
# `budmon` (the four platform tables) within 90 s. The api and the worker it starts (working
# directory: the repository root, A-73) accept their configuration: the output never contains
# "Configuration invalid", and both report a valid start (S-2: "api: configuration is valid" /
# "worker: configuration is valid"; from S-4/S-6 their `api_started` / `worker_started` events).
# Then `pnpm db:migrate` (the development wrapper, A-83) exits 0 and prints the schema step's report
# with zero migrations applied (A-80: the folder holds no journal until the first release).
# TP-4.23 (S-4, A-55): the api answers `GET /health/ready` with 200 within the same 90 s (port
# from .env.example's PORT, default 3000).
#
# Runs in CI's `dev-smoke` job (main only). It clones the committed state of this repository (HEAD,
# or the ref given as $1) into a temporary directory, installs, starts `pnpm dev` in the
# background, polls, and always stops the dev stack (`docker compose -p budmon-dev … down -v`).
# The database is checked with psql at DEV_SUPERUSER_URL's host (default: .env.example's value,
# postgres://postgres:postgres@localhost:5432/postgres, A-59).
#
# Usage: tools/ci/test/dev-smoke.sh [ref]
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
ref="${1:-HEAD}"
commit="$(git -C "$repo_root" rev-parse --verify "${ref}^{commit}")"
superuser_url="${DEV_SUPERUSER_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
budmon_url="${superuser_url%/*}/budmon"
api_port="${PORT:-3000}"
deadline_seconds=90

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/budmon-dev-smoke.XXXXXX")"
checkout="$work_dir/budmon"
dev_pid=""

# shellcheck disable=SC2317 # called through the EXIT trap
cleanup() {
  if [[ -n "$dev_pid" ]]; then
    kill -TERM -- "-$dev_pid" 2>/dev/null || true
    sleep 1
    kill -KILL -- "-$dev_pid" 2>/dev/null || true
  fi
  if [[ -f "$checkout/infra/compose.yaml" ]]; then
    docker compose -p budmon-dev -f "$checkout/infra/compose.yaml" down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "TP-2.18: cloning ${commit}"
git clone --quiet --no-hardlinks "$repo_root" "$checkout"
git -C "$checkout" checkout --quiet --detach "$commit"
(cd "$checkout" && pnpm install --frozen-lockfile)
if [[ -e "$checkout/.env" ]]; then
  echo "TP-2.18: the fresh clone already has a .env" >&2
  exit 1
fi

echo "TP-2.18: starting pnpm dev"
setsid bash -c "cd '$checkout' && exec pnpm dev" >"$work_dir/dev.log" 2>&1 &
dev_pid=$!

api_started() { grep -qE 'api: configuration is valid|"event":"api_started"' "$work_dir/dev.log"; }
worker_started() { grep -qE 'worker: configuration is valid|"event":"worker_started"' "$work_dir/dev.log"; }
config_invalid() { grep -q 'Configuration invalid' "$work_dir/dev.log"; }
api_ready() { [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${api_port}/health/ready" 2>/dev/null || true)" == "200" ]]; }

tables=""
for ((elapsed = 0; elapsed < deadline_seconds; elapsed += 2)); do
  if config_invalid; then
    echo "TP-2.18: a process reported \"Configuration invalid\"" >&2
    break
  fi
  if [[ -d "$checkout/.data/dev-secrets" ]] && [[ -n "$(ls -A "$checkout/.data/dev-secrets" 2>/dev/null)" ]]; then
    tables="$(psql "$budmon_url" -tAc "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || true)"
    if [[ "$tables" == "currencies,exchange_rates,idempotency_records,rate_limit_counters" ]] && api_started && worker_started && api_ready; then
      if ! cmp -s "$checkout/.env.example" "$checkout/.env"; then
        echo "TP-2.18: .env wasn't created as a copy of .env.example" >&2
        exit 1
      fi
      # Let any late output arrive before the final check.
      sleep 2
      if config_invalid; then
        echo "TP-2.18: a process reported \"Configuration invalid\"" >&2
        break
      fi
      echo "TP-2.18: running pnpm db:migrate"
      migrate_status=0
      (cd "$checkout" && pnpm db:migrate) >"$work_dir/migrate.log" 2>&1 || migrate_status=$?
      if [[ "$migrate_status" -ne 0 ]]; then
        echo "TP-2.18: pnpm db:migrate exited ${migrate_status}" >&2
        tail -n 40 "$work_dir/migrate.log" >&2 || true
        exit 1
      fi
      if ! grep -qE '"migrationsApplied":0[,}]' "$work_dir/migrate.log"; then
        echo "TP-2.18: pnpm db:migrate printed no report with zero migrations applied" >&2
        tail -n 40 "$work_dir/migrate.log" >&2 || true
        exit 1
      fi
      echo "TP-2.18: passed after ${elapsed}s (.env and dev secrets created; budmon has the four platform tables; api and worker started; /health/ready 200; db:migrate applied zero migrations)"
      exit 0
    fi
  fi
  if ! kill -0 "$dev_pid" 2>/dev/null; then
    echo "TP-2.18: pnpm dev exited early" >&2
    break
  fi
  sleep 2
done

secrets="$(find "$checkout/.data/dev-secrets" -mindepth 1 -maxdepth 1 -printf '%f ' 2>/dev/null || true)"
api_state="no"; api_started && api_state="yes"
worker_state="no"; worker_started && worker_state="yes"
ready_state="no"; api_ready && ready_state="yes"
echo "TP-2.18: failed (dev secrets: ${secrets:-none}; tables: ${tables:-none}; api started: ${api_state}; worker started: ${worker_state}; /health/ready 200: ${ready_state})" >&2
tail -n 40 "$work_dir/dev.log" >&2 || true
exit 1
