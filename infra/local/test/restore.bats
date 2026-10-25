#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `restore`. TP-15.22 (f) to (h7), stub part.
#
# docker is a stub; SQL sent to psql (in arguments or on stdin) is appended to $CALLS as a line
# starting `sql<TAB>`, so ordering against other calls is kept. Behaviour per case:
#   LIST_EXIT / LIST_OUTPUT  `pg_restore --list` (default: lists TABLE public and TABLE pgboss)
#   SAFETY_EXIT              the safety pg_dump (default 0)
#   VERIFY_EXIT              `cli.js restore:verify` (default 0)
#   READY_EXIT               readiness checks (default 0)
#   RENAME_FAILS             how many RENAME statements fail before one succeeds (default 0)
#   DB_SIZE                  pg_database_size('budmon') in bytes (default 1000)
#   SIZE_EXIT / SIZE_OUTPUT  the size query's exit code / raw output (A-420)
#   SQL_FAIL_PATTERN         SQL matching this ERE fails, after SQL_FAIL_SKIP matches have passed
#   UP_FAIL_MATCH            an `up -d` whose arguments contain this fails
#   PG_FAIL_AFTER_READY      pg_isready fails once a readiness probe has failed (A-426 (b))
#   PROBE_SLEEP / PG_PROBE_SLEEP  seconds each readiness / pg_isready probe takes (A-433)
#   MIGRATE_FAIL             budmon_restore's migrate prints a log line and exits 1 (A-435)
#   RESTORE_EXIT             `pg_restore` into budmon_restore (not --list) (default 0; A-447)
#   DF_AVAIL_BYTES           free space reported by df (default 10^12)
#
# A-388: free space is `df -Pk -- <dir>` field 4 × 1024 (pg/, and dumps/ on another filesystem),
# the dump's size `stat -c %s` (real files here), the database size `pg_database_size('budmon')`
# through `psql -Atc` in the Postgres container; messages round MB up. A-387: BUDMON_PG_READY_TIMEOUT,
# BUDMON_READY_TIMEOUT and BUDMON_RENAME_RETRY_DELAY are positive integer seconds, else exit 64.

bats_require_minimum_version 1.5.0

load helpers

DUMP_NAME="20261001T120000Z_v1.1.0.dump"

setup() {
  common_setup
  write_state v1.2.0 v1.1.0
  make_release v1.1.0
  make_release v1.2.0
  mkdir -p "${BUDMON_HOME}/dumps" "${BUDMON_HOME}/maintenance" "${BUDMON_HOME}/pg"
  printf 'PGDMP-fake-dump-content' >"${BUDMON_HOME}/dumps/${DUMP_NAME}"
  chmod 0600 "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  : >"${BUDMON_HOME}/rename-count"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-parse) echo "0000000000000000000000000000000000000000" ;;
    tag) echo "v1.1.0" ;;
  esac
  return 0
}
stub_df() {
  # A-388: only `df -Pk -- <dir>` is answered.
  [ "$1" = "-Pk" ] && [ "$2" = "--" ] || { echo "stub df: unexpected: $*" >&2; return 2; }
  local kb=$(( ${DF_AVAIL_BYTES:-1000000000000} / 1024 ))
  echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
  echo "/dev/x ${kb} 0 ${kb} 0% /"
}
stub_docker() {
  stack_answer "$@" && return "${STACK_EXIT:-0}"
  local all="$*"
  if [[ "${all}" == *"psql"* ]]; then
    local sql="${all}"
    if [ ! -t 0 ]; then sql="${sql} $(cat)"; fi
    printf 'sql\t%s\n' "${sql//$'\n'/ }" >>"${CALLS}"
    if [[ "${sql}" == *"pg_database_size"* ]]; then
      [ "${SIZE_EXIT:-0}" != 0 ] && return "${SIZE_EXIT}"
      echo "${SIZE_OUTPUT:-${DB_SIZE:-1000}}"
    fi
    if [ -n "${SQL_FAIL_PATTERN:-}" ] && [[ "${sql}" =~ ${SQL_FAIL_PATTERN} ]]; then
      local seen; seen="$(wc -c <"${BUDMON_HOME}/sql-fail-count" 2>/dev/null || echo 0)"
      printf 'x' >>"${BUDMON_HOME}/sql-fail-count"
      if [ "${seen}" -ge "${SQL_FAIL_SKIP:-0}" ]; then echo "ERROR:  stub failure" >&2; return 1; fi
    fi
    if [[ "${sql}" == *"RENAME TO"* ]]; then
      local n; n="$(wc -c <"${BUDMON_HOME}/rename-count")"
      if [ "${n}" -lt "${RENAME_FAILS:-0}" ]; then
        printf 'x' >>"${BUDMON_HOME}/rename-count"
        echo 'ERROR:  database "budmon" is being accessed by other users' >&2
        return 1
      fi
    fi
    return 0
  fi
  if [[ "${all}" == *" up -d"* && -n "${UP_FAIL_MATCH:-}" && "${all}" == *"${UP_FAIL_MATCH}"* ]]; then
    return 1
  fi
  if [[ "${MIGRATE_FAIL:-0}" = 1 && "${all}" == *" migrate"* && "${all}" == *"DB_NAME=budmon_restore"* && "${all}" != *"restore:verify"* ]]; then
    echo '{"msg":"migration_failed","code":"42P01"}'
    return 1
  fi
  if [[ "${all}" == *"pg_restore"*"--list"* ]]; then
    cat >/dev/null
    if [ -n "${LIST_OUTPUT+x}" ]; then printf '%s\n' "${LIST_OUTPUT}"; else
      printf '%s\n' "215; 1259 16390 TABLE public currencies budmon_migrator" "216; 1259 16400 TABLE pgboss job budmon_queue"
    fi
    return "${LIST_EXIT:-0}"
  fi
  if [[ "${all}" == *"pg_restore"* && "${all}" == *"budmon_restore"* ]]; then
    cat >/dev/null
    [ "${RESTORE_EXIT:-0}" != 0 ] && echo "pg_restore: error: stub failure" >&2
    return "${RESTORE_EXIT:-0}"
  fi
  if [[ "${all}" == *"pg_dump"* ]]; then printf 'PGDMP-safety'; return "${SAFETY_EXIT:-0}"; fi
  if [[ "${all}" == *"restore:verify"* ]]; then echo '{"ok":true}'; return "${VERIFY_EXIT:-0}"; fi
  if [[ "${all}" == *"pg_isready"* ]]; then
    [ -n "${PG_PROBE_SLEEP:-}" ] && /bin/sleep "${PG_PROBE_SLEEP}"
    if [ "${PG_FAIL_AFTER_READY:-0}" = 1 ] && [ -e "${BUDMON_HOME}/.stub-ready-failed" ]; then return 1; fi
    return 0
  fi
  if [[ "${all}" == *"healthcheck"* ]]; then
    [ -n "${PROBE_SLEEP:-}" ] && /bin/sleep "${PROBE_SLEEP}"
    [ "${READY_EXIT:-0}" != 0 ] && : >"${BUDMON_HOME}/.stub-ready-failed"
    return "${READY_EXIT:-0}"
  fi
  return 0
}
CONF
}

run_restore() {
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "$@"
}

# The ordered events of a restore, as short names.
events() {
  awk -F'\t' '
    $1=="docker" && $3 ~ /pg_restore/ && $3 ~ /--list/ { print "list"; next }
    $1=="docker" && $3 ~ /pg_dump/ { print "safety-dump"; next }
    $1=="sql" && $2 ~ /CREATE DATABASE "budmon_restore"/ { print "create-restore-db" }
    $1=="docker" && $3 ~ /pg_restore/ && $3 ~ /budmon_restore/ { print "pg_restore"; next }
    $1=="docker" && $3 ~ /migrate/ && $3 ~ /budmon_restore/ && $3 !~ /restore:verify/ { print "migrate"; next }
    $1=="docker" && $3 ~ /restore:verify/ { print "verify"; next }
    $1=="docker" && $3 ~ / stop / { print "stop"; next }
    $1=="sql" && $2 ~ /RENAME TO "budmon_old_/ { print "rename-old" }
    $1=="sql" && $2 ~ /"budmon_restore" RENAME TO "budmon"/ { print "rename-new" }
    $1=="docker" && $3 ~ / up -d/ { print "up" }
  ' "${CALLS}" | uniq
}

@test "TP-15.22 (f): restore of a v1.1.0 dump: list, safety dump, budmon_restore restored and migrated and verified, then the switch, up with releases/v1.1.0, state current=v1.1.0, exit 0" {
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success

  run events
  local seq; seq="$(printf '%s' "${output}" | tr '\n' ' ')"
  [[ "${seq}" == "list safety-dump create-restore-db pg_restore migrate verify stop "* ]] || { echo "${seq}"; return 1; }
  [[ "${seq}" == *"rename-old rename-new"*"up"* ]] || { echo "${seq}"; return 1; }

  local safety; safety="$(find "${BUDMON_HOME}/dumps" -name '*_v1.2.0_pre-restore.dump')"
  [[ "$(basename "${safety}")" =~ ^[0-9]{8}T[0-9]{6}Z_v1\.2\.0_pre-restore\.dump$ ]]
  [ "$(stat -c '%a' "${safety}")" = "600" ]

  run bash -c "awk -F'\t' '\$1==\"docker\" && (\$3 ~ /restore:verify/ || (\$3 ~ /migrate/ && \$3 ~ /run/))' '${CALLS}'"
  assert_output --partial "DB_NAME=budmon_restore"
  assert_output --partial "releases/v1.1.0/"

  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/' '${CALLS}'"
  assert_output --partial "releases/v1.1.0/compose.main.yaml"
  assert_output --partial "TAG=v1.1.0"
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.1.0"
  assert_line "previous=v1.2.0"
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
}

@test "TP-15.22 (f): the switch blocks connections before terminating, and re-opens the new budmon" {
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tr '\n' ' '"
  [[ "${output}" == *"ALLOW_CONNECTIONS false"*"pg_terminate_backend"*'RENAME TO "budmon_old_'*"ALLOW_CONNECTIONS true"* ]] || { echo "${output}"; return 1; }
}

@test "TP-15.22 (g): restore:verify failing exits 6 with no rename, no maintenance, state unchanged, and prints the safety dump path" {
  export VERIFY_EXIT=6
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 6
  assert_output --regexp "dumps/[0-9]{8}T[0-9]{6}Z_v1\.2\.0_pre-restore\.dump"
  run grep -c "RENAME TO" "${CALLS}"
  assert_output "0"
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}

# A-447: every step-5 failure exits 29 with its reason, after the safety dump's path.
assert_step5_failure() {
  local reason="$1"
  assert_failure 29
  [[ "${stderr}" =~ budmon-local:\ safety\ dump:\ [^$'\n']*dumps/[0-9]{8}T[0-9]{6}Z_v1\.2\.0_pre-restore\.dump$'\n'[^$'\n']*"${reason}" ]] ||
    { echo "stderr: ${stderr}"; return 1; }
  run events
  refute_output --partial "migrate"
  refute_output --partial "verify"
  run grep -c "RENAME TO" "${CALLS}"
  assert_output "0"
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
  assert_line "previous=v1.1.0"
}

@test "TP-15.22 (h8): pg_restore into budmon_restore failing exits 29 after the safety dump's path; no migrate, maintenance, rename or state change" {
  export RESTORE_EXIT=1
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_step5_failure "pg_restore into budmon_restore failed"
}

@test "TP-15.22 (h8): the cluster bootstrap re-apply failing exits 29 after the safety dump's path; no migrate, maintenance, rename or state change" {
  export SQL_FAIL_PATTERN="10-budmon\.sql\.tpl"
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_step5_failure "re-applying the cluster bootstrap failed"
}

@test "TP-15.22 (g2): a readiness timeout reverses the renames (budmon_restore_failed_<ts>), starts v1.2.0 again, keeps maintenance on, exit 16" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1
  local started=${SECONDS}
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 16
  # A-387: the 1 s override bounds the wait.
  [ $((SECONDS - started)) -le 2 ] || { echo "took $((SECONDS - started)) s"; return 1; }
  run bash -c "awk -F'\t' '\$1==\"sql\"' '${CALLS}'"
  assert_output --regexp 'RENAME TO "budmon_restore_failed_[0-9]{8}T[0-9]{6}Z"'
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/' '${CALLS}' | tail -n 1"
  assert_output --partial "releases/v1.2.0/"
  assert [ -e "${BUDMON_HOME}/maintenance/on" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
  # A-426: the rollback never stops postgres.
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / stop( |$)/ { print \$3 }' '${CALLS}'"
  refute_output --regexp "stop.*(postgres|caddy|mailpit)"
}

@test "TP-15.22 (h): restore foo.dump exits 12" {
  printf 'x' >"${BUDMON_HOME}/dumps/foo.dump"
  run_restore "${BUDMON_HOME}/dumps/foo.dump"
  assert_failure 12
}

@test "TP-15.22 (h2): a dump whose pg_restore --list fails exits 14 before any database call" {
  export LIST_EXIT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 14
  run grep -c "^sql" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h3): a dump listing no pgboss table exits 14 before any database call" {
  export LIST_OUTPUT="215; 1259 16390 TABLE public currencies budmon_migrator"
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 14
  run grep -c "^sql" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h4): a failing safety pg_dump exits 19 with no database created" {
  export SAFETY_EXIT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 19
  run grep -c "CREATE DATABASE" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (h5): free space below 3 × the dump size + the database size exits 23 with both sizes and no database created" {
  export DB_SIZE=$((500 * 1024 * 1024)) DF_AVAIL_BYTES=$((100 * 1024 * 1024))
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 23
  assert_output --regexp "not enough disk space: need [0-9]+ MB, have [0-9]+ MB"
  run grep -c "CREATE DATABASE" "${CALLS}"
  assert_output "0"
}

@test "TP-15.22 (A-388): 100 MB free, a 30 MB dump and a 20 MB database: exit 23 need 110 MB, have 100 MB, measured with df -Pk on pg/" {
  truncate -s $((30 * 1024 * 1024)) "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  export DB_SIZE=$((20 * 1024 * 1024)) DF_AVAIL_BYTES=$((100 * 1024 * 1024))
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 23
  assert_output --partial "need 110 MB, have 100 MB"
  run grep -c "CREATE DATABASE" "${CALLS}"
  assert_output "0"
  run bash -c "awk -F'\t' '\$1==\"df\" { print \$3 }' '${CALLS}'"
  assert_line "-Pk -- ${BUDMON_HOME}/pg"
  run bash -c "awk -F'\t' '\$1==\"sql\" && \$2 ~ /pg_database_size/' '${CALLS}'"
  assert_output --partial "psql"
  assert_output --partial "-Atc"
}

@test "TP-15.22 (A-420): the size query failing, then printing abc: exit 23 (can't read the database size) both times, no budmon_restore" {
  local mode
  for mode in fail abc; do
    : >"${CALLS}"
    if [ "${mode}" = fail ]; then export SIZE_EXIT=2; unset SIZE_OUTPUT; else unset SIZE_EXIT; export SIZE_OUTPUT=abc; fi
    run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
    [ "${status}" -eq 23 ] || { echo "${mode}: exit ${status}: ${output}"; return 1; }
    assert_output --partial "disk space check failed: can't read the database size"
    run grep -c "CREATE DATABASE" "${CALLS}"
    assert_output "0"
  done
}

@test "TP-15.22 (A-420): every psql call but the size query takes its SQL on stdin" {
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /psql/ && \$3 !~ /pg_database_size/ { print \$3 }' '${CALLS}'"
  [ "${#lines[@]}" -gt 0 ] || { echo "no psql calls"; return 1; }
  refute_output --regexp "(CREATE|ALTER|DROP|SELECT|GRANT|REVOKE) "
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /pg_database_size/ { print \$3 }' '${CALLS}'"
  assert_output --partial "-Atc"
}

@test "TP-15.22 (A-387): a timeout override that isn't a positive integer exits 64" {
  local var value
  for var in BUDMON_PG_READY_TIMEOUT BUDMON_READY_TIMEOUT BUDMON_RENAME_RETRY_DELAY; do
    for value in abc 0 -1 1.5; do
      : >"${CALLS}"
      BUDMON_REEXEC=1 run env "${var}=${value}" "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
      [ "${status}" -eq 64 ] || { echo "${var}=${value}: exit ${status}: ${output}"; return 1; }
      run grep -c "^sql" "${CALLS}"
      assert_output "0"
    done
  done
}

@test "TP-15.22 (h6): the first rename failing twice then succeeding: ALLOW_CONNECTIONS false before terminating, three attempts, ALLOW_CONNECTIONS true on the new budmon, exit 0" {
  export RENAME_FAILS=2
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_success
  [ "$(grep -c 'RENAME TO "budmon_old_' "${CALLS}")" -eq 3 ]
  [ "$(grep -c 'pg_terminate_backend' "${CALLS}")" -ge 3 ]
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tr '\n' ' '"
  [[ "${output}" == *"ALLOW_CONNECTIONS false"*"pg_terminate_backend"* ]] || { echo "${output}"; return 1; }
  [[ "${output}" == *'ALTER DATABASE "budmon" WITH ALLOW_CONNECTIONS true'* ]] || { echo "${output}"; return 1; }
  # A-484: each of the three attempts terminates budmon's sessions only.
  [ "$(grep -c "WHERE datname = 'budmon' AND pid <> pg_backend_pid()" "${CALLS}")" -ge 3 ]
  assert_per_rename_termination
}

@test "TP-15.22 (h7): the rename failing 3 times exits 24 with names unchanged and ALLOW_CONNECTIONS true on budmon" {
  export RENAME_FAILS=99
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 24
  run grep -c '"budmon_restore" RENAME TO "budmon"' "${CALLS}"
  assert_output "0"
  # A-426: exit 24 means the names are restored, so no marker stays.
  [ ! -e "${BUDMON_HOME}/restore.inprogress" ]
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tail -n 3 | tr '\n' ' '"
  [[ "${output}" == *'ALTER DATABASE "budmon" WITH ALLOW_CONNECTIONS true'* ]] || { echo "${output}"; return 1; }
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}

@test "TP-15.22 (h7): the second rename failing 3 times exits 24, renames budmon_old_<ts> back, re-opens budmon, no marker, state unchanged" {
  export SQL_FAIL_PATTERN='"budmon_restore" RENAME TO "budmon"'
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 24
  assert_output --partial "budmon_restore is still in use; the names are restored"
  run grep -c '"budmon_restore" RENAME TO "budmon"' "${CALLS}"
  assert_output "3"
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}' | tr '\n' ' '"
  [[ "${output}" =~ \"budmon_old_[0-9]{8}T[0-9]{6}Z\"\ RENAME\ TO\ \"budmon\" ]] || { echo "${output}"; return 1; }
  [[ "${output}" == *'"budmon_restore" RENAME TO "budmon"'*'RENAME TO "budmon"'*'ALTER DATABASE "budmon" WITH ALLOW_CONNECTIONS true'* ]] || { echo "${output}"; return 1; }
  [ ! -e "${BUDMON_HOME}/restore.inprogress" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
}

@test "TP-15.22 (h8): dropping budmon_restore failing exits 29 after the safety dump's path; no migrate, maintenance, rename or state change" {
  export SQL_FAIL_PATTERN='DROP DATABASE IF EXISTS "budmon_restore"'
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_step5_failure "dropping budmon_restore failed"
}

@test "TP-15.22 (h8): creating budmon_restore failing exits 29 after the safety dump's path; no migrate, maintenance, rename or state change" {
  export SQL_FAIL_PATTERN='CREATE DATABASE "budmon_restore"'
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_step5_failure "creating budmon_restore failed"
}

# A-484: every rename attempt is preceded by the termination of that rename's <from> only, and
# no statement terminates a fixed pair (`datname IN`).
assert_per_rename_termination() {
  run bash -c "awk -F'\t' '\$1==\"sql\" { print \$2 }' '${CALLS}'"
  refute_output --partial "datname IN"
  local prev="" line from n=0
  while IFS= read -r line; do
    if [[ "${line}" =~ ALTER\ DATABASE\ \"([a-z0-9_TZ]+)\"\ RENAME\ TO ]]; then
      from="${BASH_REMATCH[1]}"
      n=$((n + 1))
      [[ "${prev}" == *"pg_terminate_backend"*"WHERE datname = '${from}' AND pid <> pg_backend_pid()"* ]] || {
        echo "rename of ${from} not preceded by its own termination; previous: ${prev}"
        return 1
      }
    fi
    prev="${line}"
  done <<<"${output}"
  [ "${n}" -gt 0 ] || { echo "no rename recorded"; return 1; }
}

# ---- TP-15.36 (A-426): the rollback stops only the app and checks every step ----

# The rollback's part of $CALLS: everything after the last readiness probe.
rollback_events() {
  awk -F'\t' '
    $1=="docker" && $3 ~ /healthcheck/ { n = NR }
    { line[NR] = $0 }
    END {
      for (i = n + 1; i <= NR; i++) {
        split(line[i], f, "\t")
        if (f[1]=="docker" && f[3] ~ / stop api worker-general$/ && f[3] ~ /releases\/v1\.1\.0\//) print "stop-main"
        else if (f[1]=="docker" && f[3] ~ / stop worker-capture$/ && f[3] ~ /releases\/v1\.1\.0\//) print "stop-capture"
        else if (f[1]=="docker" && f[3] ~ /pg_isready/) print "pg_isready"
        else if (f[1]=="sql" && f[2] ~ /ALLOW_CONNECTIONS false/) print "allow-false"
        else if (f[1]=="sql" && f[2] ~ /"budmon" RENAME TO "budmon_restore_failed_/) print "rename-failed"
        else if (f[1]=="sql" && f[2] ~ /"budmon_old_[0-9TZ]+" RENAME TO "budmon"/) print "rename-back"
        else if (f[1]=="sql" && f[2] ~ /ALLOW_CONNECTIONS true/) print "allow-true"
        else if (f[1]=="docker" && f[3] ~ / up -d/ && f[3] ~ /releases\/v1\.2\.0\//) print "up-v1.2.0"
      }
    }' "${CALLS}" | uniq
}

# The marker's four keys, maintenance on, the safety dump printed, state unchanged (A-426).
assert_unfinished() {
  [ -e "${BUDMON_HOME}/restore.inprogress" ] || { echo "no marker"; return 1; }
  local key
  for key in tag from old failed; do
    grep -q "^${key}=" "${BUDMON_HOME}/restore.inprogress" || { echo "marker lacks ${key}"; return 1; }
  done
  [ -e "${BUDMON_HOME}/maintenance/on" ] || { echo "maintenance off"; return 1; }
  [[ "${output}" == *"_v1.2.0_pre-restore.dump"* ]] || { echo "safety dump not printed"; return 1; }
  grep -qx "current=v1.2.0" "${BUDMON_HOME}/state" || { echo "state changed"; return 1; }
}

@test "TP-15.36 (a): the rollback stops only api, worker-general and worker-capture, waits for Postgres, then renames back, re-opens budmon and starts v1.2.0: exit 16" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 16

  run rollback_events
  [ "$(tr '\n' ' ' <<<"${output}")" = "stop-main stop-capture pg_isready allow-false rename-failed rename-back allow-true up-v1.2.0 " ] || {
    echo "rollback: $(tr '\n' ' ' <<<"${output}")"
    return 1
  }
  # No call stops postgres, caddy or mailpit, or stops/downs without naming services.
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / (stop|down)( |$)/ { print \$3 }' '${CALLS}'"
  refute_output --regexp "(stop|down) .*(postgres|caddy|mailpit)"
  refute_output --regexp " (stop|down)$"
  [ ! -e "${BUDMON_HOME}/restore.inprogress" ]
  [ -e "${BUDMON_HOME}/maintenance/on" ]
  # A-484: datname = 'budmon' before the rename to budmon_restore_failed_<ts>, and
  # datname = 'budmon_old_<ts>' before the reverse rename.
  assert_per_rename_termination
  run grep -cE "WHERE datname = 'budmon_old_[0-9]{8}T[0-9]{6}Z' AND pid <> pg_backend_pid\(\)" "${CALLS}"
  [ "${output}" -ge 1 ]
}

@test "TP-15.36 (b): Postgres not coming back in the rollback: exit 26, no rename and no up -d after the readiness timeout" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1 BUDMON_PG_READY_TIMEOUT=1 PG_FAIL_AFTER_READY=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 26
  assert_output --regexp "restore rollback incomplete: budmon holds the restored copy and the data from before the restore is in budmon_old_[0-9]{8}T[0-9]{6}Z"
  assert_unfinished
  run rollback_events
  refute_output --regexp "rename-|up-v1"
}

@test "TP-15.36 (c): the rename budmon -> budmon_restore_failed_<ts> failing 3 times: exit 26, the same message" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1 SQL_FAIL_PATTERN='RENAME TO "budmon_restore_failed_'
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 26
  assert_output --regexp "restore rollback incomplete: budmon holds the restored copy and the data from before the restore is in budmon_old_"
  assert_unfinished
}

@test "TP-15.36 (d): the rename budmon_old_<ts> -> budmon failing 3 times: exit 26, budmon is missing" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1 SQL_FAIL_PATTERN='"budmon_old_[0-9TZ]+" RENAME TO "budmon"'
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 26
  assert_output --regexp "restore rollback incomplete: budmon is missing; the data from before the restore is in budmon_old_[0-9TZ]+ and the restored copy in budmon_restore_failed_[0-9TZ]+"
  assert_unfinished
  # A-484: all three attempts of the reverse rename terminate budmon_old_<ts>'s sessions.
  run grep -cE "WHERE datname = 'budmon_old_[0-9]{8}T[0-9]{6}Z' AND pid <> pg_backend_pid\(\)" "${CALLS}"
  [ "${output}" -ge 3 ]
  assert_per_rename_termination
}

@test "TP-15.36 (e): ALLOW_CONNECTIONS true failing after the reverse renames: exit 26, refuses connections" {
  # The switch's own ALLOW_CONNECTIONS true passes; the rollback's fails.
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1 SQL_FAIL_PATTERN="ALLOW_CONNECTIONS true" SQL_FAIL_SKIP=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 26
  assert_output --partial "budmon holds the data from before the restore but refuses connections"
  assert_unfinished
}

@test "TP-15.36 (f): the final up -d with releases/v1.2.0/ failing: exit 17, run budmon-local start, no marker" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1 UP_FAIL_MATCH="releases/v1.2.0/"
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 17
  assert_output --partial "starting v1.2.0 failed: run budmon-local start"
  [ ! -e "${BUDMON_HOME}/restore.inprogress" ]
}

@test "TP-15.36 (g): step 7's second rename failing 3 times and the reverse rename failing too: exit 26 naming budmon_old_<ts> and budmon_restore" {
  export SQL_FAIL_PATTERN='"budmon_restore" RENAME TO "budmon"|"budmon_old_[0-9TZ]+" RENAME TO "budmon"'
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 26
  assert_output --regexp "budmon_old_[0-9]{8}T[0-9]{6}Z"
  assert_output --partial "budmon_restore"
  assert_unfinished
}

# ---- TP-15.43 (A-433): waits are bounded by a deadline, with at least one probe ----

@test "TP-15.43: restore (g2) with probes taking 3 s and BUDMON_READY_TIMEOUT=2: at most 2 probes, back within 6 s" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=2 PROBE_SLEEP=3
  local started=${SECONDS}
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 16
  local probes
  probes="$(awk -F'\t' '$1=="docker" && $3 ~ /exec -T api .*healthcheck/' "${CALLS}" | wc -l)"
  [ "${probes}" -le 2 ] || { echo "${probes} probes"; return 1; }
  [ $((SECONDS - started)) -le 7 ] || { echo "took $((SECONDS - started)) s"; return 1; }
}

@test "TP-15.43: a probe failing at once with BUDMON_READY_TIMEOUT=1 is made at least once" {
  export READY_EXIT=1 BUDMON_READY_TIMEOUT=1
  run_restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  local probes
  probes="$(awk -F'\t' '$1=="docker" && $3 ~ /exec -T api .*healthcheck/' "${CALLS}" | wc -l)"
  [ "${probes}" -ge 1 ]
}

# ---- TP-15.44 (A-435): migrate's output reaches stderr before the exit-15 line ----

@test "TP-15.44: restore with the dump's migrate failing exits 15; stderr has migrate's line before the reason" {
  export MIGRATE_FAIL=1
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 15
  local line reason
  line="$(grep -n '{"msg":"migration_failed","code":"42P01"}' <<<"${stderr}" | head -n 1 | cut -d: -f1)"
  reason="$(grep -n 'migrate.*failed' <<<"${stderr}" | grep -v migration_failed | head -n 1 | cut -d: -f1)"
  [ -n "${line}" ] && [ -n "${reason}" ] && [ "${line}" -lt "${reason}" ] || { echo "${stderr}"; return 1; }
}


# ---- TP-15.47 (A-502 (2)): restore step 8's up -d failing rolls back at once ----

# The rollback's events after the failing `up -d` of releases/v1.1.0's main project.
events_after_failed_up() {
  awk -F'\t' '
    !found && $1=="docker" && $3 ~ /-p budmon-main / && $3 ~ / up -d/ && $3 ~ /releases\/v1\.1\.0\// { found = 1; next }
    found {
      if ($1=="docker" && $3 ~ / stop api worker-general$/ && $3 ~ /releases\/v1\.1\.0\//) print "stop-main"
      else if ($1=="docker" && $3 ~ / stop worker-capture$/ && $3 ~ /releases\/v1\.1\.0\//) print "stop-capture"
      else if ($1=="docker" && $3 ~ /pg_isready/) print "pg_isready"
      else if ($1=="sql" && $2 ~ /ALLOW_CONNECTIONS false/) print "allow-false"
      else if ($1=="sql" && $2 ~ /"budmon" RENAME TO "budmon_restore_failed_/) print "rename-failed"
      else if ($1=="sql" && $2 ~ /"budmon_old_[0-9TZ]+" RENAME TO "budmon"/) print "rename-back"
      else if ($1=="sql" && $2 ~ /ALLOW_CONNECTIONS true/) print "allow-true"
      else if ($1=="docker" && $3 ~ / up -d/ && $3 ~ /releases\/v1\.2\.0\//) print "up-v1.2.0"
    }' "${CALLS}" | uniq
}

@test "TP-15.47 (e): v1.1.0's main up -d failing skips the wait, runs r1 to r8 in order, and exits 31; maintenance stays on" {
  export UP_EXIT_main=1 UP_EXIT_MATCH="*/releases/v1.1.0/*"
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 31
  [[ "${stderr}" == *"v1.1.0 didn't start on the restored database (docker compose up -d for budmon-main exited 1); v1.2.0 and its database are back, maintenance stays on"* ]] || { echo "${stderr}"; return 1; }
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /healthcheck/' '${CALLS}'"
  assert_output ""
  run events_after_failed_up
  [ "$(tr '\n' ' ' <<<"${output}")" = "stop-main stop-capture pg_isready allow-false rename-failed rename-back allow-true up-v1.2.0 " ] || {
    echo "rollback: $(tr '\n' ' ' <<<"${output}")"
    return 1
  }
  [ -e "${BUDMON_HOME}/maintenance/on" ]
}

@test "TP-15.47 (e2): as (e) with r8's up -d failing too exits 17 (run budmon-local start)" {
  export UP_EXIT_main=1 UP_EXIT_MATCH="*/releases/v1.1.0/*" UP_FAIL_MATCH="releases/v1.2.0/"
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" restore "${BUDMON_HOME}/dumps/${DUMP_NAME}"
  assert_failure 17
  [[ "${stderr}" == *"v1.1.0 didn't start on the restored database; the database is back but starting v1.2.0 failed: run budmon-local start"* ]] || { echo "${stderr}"; return 1; }
}
