#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 phase B (`_upgrade-continue`), rollback and release copies. TP-15.21.
#
# The release copies are real copies of infra/local (make_release); phase B runs from
# releases/v1.2.0/ with BUDMON_REEXEC=1, as phase A leaves it. docker is a stub whose behaviour each
# case sets through environment variables:
#   BUILD_EXIT   exit code of `docker build` (default 0)
#   MIGRATE_EXIT exit code of the migrate run (default 0); MIGRATE_OUTPUT its stdout
#   READY_EXIT   exit code of every readiness or health check (default 0)
#   OLD_UP_EXIT  exit code of `up -d` with releases/v1.1.0 files (default 0)

bats_require_minimum_version 1.5.0

load helpers

CANARY="CANARY-secret-tp-15-21-7f3a"

WEB_DSN="https://pub@o1.ingest.sentry.io/2"

setup() {
  common_setup
  write_state v1.1.0 v1.0.0
  make_release v1.1.0
  make_release v1.2.0
  mkdir -p "${BUDMON_HOME}/build/v1.2.0/apps/server" "${BUDMON_HOME}/dumps" "${BUDMON_HOME}/maintenance"
  # A-423: the web build's DSN comes from site.env.
  printf 'PUBLIC_ORIGIN=https://laptop.tailnet.ts.net\nWEB_SENTRY_DSN=%s\n' "${WEB_DSN}" >"${BUDMON_HOME}/site.env"
  chmod 0600 "${BUDMON_HOME}/site.env"
  mkdir -p "${BUDMON_HOME}/secrets/main/api"
  printf '%s' "${CANARY}" >"${BUDMON_HOME}/secrets/main/api/CURSOR_KEY"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-list) echo 42 ;;
    rev-parse) echo "c0ffee0000000000000000000000000000000001" ;;
  esac
  return 0
}
stub_docker() {
  stack_answer "$@" && return "${STACK_EXIT:-0}"
  local all="$*"
  case "${all}" in
    build*) return "${BUILD_EXIT:-0}" ;;
  esac
  if [[ "${all}" == *" pg_dump "* ]]; then
    printf 'PGDMP-fake-dump'
    return 0
  fi
  if [[ "${all}" == *" migrate"* && ( "${all}" == *" run "* || "${all}" == *" up "* ) ]]; then
    printf 'maint=%s\n' "$([ -e "${BUDMON_HOME}/maintenance/on" ] && echo on || echo off)" >>"${CALLS}.maint"
    printf '%s' "${MIGRATE_OUTPUT:-}"
    return "${MIGRATE_EXIT:-0}"
  fi
  if [[ "${all}" == *"healthcheck"* || "${all}" == *"inspect"* || "${all}" == *" ps "* ]]; then
    return "${READY_EXIT:-0}"
  fi
  if [[ "${all}" == *" up -d"* && "${all}" == *"/releases/v1.1.0/"* ]]; then
    return "${OLD_UP_EXIT:-0}"
  fi
  # admin_sql: SQL on stdin, recorded as a `sql` line (A-426's leftover databases).
  if [[ "${all}" == *" psql "* ]]; then
    local sql="${all}"
    if [ ! -t 0 ]; then sql="${sql} $(cat)"; fi
    printf 'sql\t%s\n' "${sql//$'\n'/ }" >>"${CALLS}"
    if [[ "${sql}" == *"count(*) FROM pg_database"* ]]; then
      [ "${COUNT_FAIL:-0}" = 1 ] && return 1
      echo "${COUNT_OUTPUT:-1}"
    elif [[ "${sql}" == *"FROM pg_database"* ]]; then
      printf '%s\n' budmon_old_20261001T120000Z budmon_restore_failed_20261001T120000Z ${EXTRA_LISTED:-}
    fi
    return 0
  fi
  return 0
}
CONF
}

run_phase_b() {
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0 "$@"
}

compose_calls() {
  # `compose` is usually the first argument, so it follows the tab, not a space.
  calls_of docker | awk -F'\t' '$3 ~ /(^| )compose /'
}

@test "TP-15.21 (a): builds, removes the worktree, dumps, migrates, starts both projects, checks readiness, then records state" {
  run_phase_b
  assert_success

  # Order of the key calls.
  run awk -F'\t' '
    $1=="docker" && $3 ~ /^build/ { print "build" }
    $1=="git" && $3 ~ /worktree remove/ { print "worktree-remove" }
    $1=="docker" && $3 ~ / pg_dump / { print "pg_dump" }
    $1=="docker" && $3 ~ / migrate/ && $3 ~ / (run|up) / { print "migrate" }
    $1=="docker" && $3 ~ / up -d/ && $3 ~ /compose\.main\.yaml/ && $3 !~ / migrate/ { print "up-main" }
    $1=="docker" && $3 ~ / up -d/ && $3 ~ /compose\.capture\.yaml/ { print "up-capture" }
    $1=="docker" && $3 ~ /healthcheck/ { print "ready" }
  ' "${CALLS}"
  local order
  order="$(printf '%s\n' "${output}" | uniq | tr '\n' ' ')"
  [[ "${order}" == "build worktree-remove pg_dump migrate up-main up-capture ready "* ]] || {
    echo "order: ${order}"
    return 1
  }

  # Three builds; the web build carries BUDMON_BUILD_NUMBER from git rev-list --count.
  run calls_of docker
  [ "$(printf '%s\n' "${output}" | awk -F'\t' '$3 ~ /^build/' | wc -l)" -eq 3 ]
  assert_output --regexp "build.*BUDMON_BUILD_NUMBER=42"
  # A-423: the web build gets the DSN from site.env.
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/ && \$3 ~ /images\/web\/Dockerfile/ { print \$3 }' '${CALLS}'"
  assert_output --partial "--build-arg VITE_SENTRY_DSN=${WEB_DSN}"
  # A-417: the one postgres build form.
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/ && \$3 ~ /images\/postgres/ { print \$3 }' '${CALLS}'"
  assert_output "build --build-context sql=${BUDMON_HOME}/build/v1.2.0/apps/server/src/platform/db/sql -t budmon/postgres:v1.2.0 ${BUDMON_HOME}/build/v1.2.0/images/postgres"

  # The dump: dumps/<UTC timestamp>_v1.1.0.dump, mode 0600.
  local dump
  dump="$(find "${BUDMON_HOME}/dumps" -name '*_v1.1.0.dump')"
  [[ "$(basename "${dump}")" =~ ^[0-9]{8}T[0-9]{6}Z_v1\.1\.0\.dump$ ]]
  [ "$(stat -c '%a' "${dump}")" = "600" ]

  # Every Compose call uses the new release copy's files.
  while IFS= read -r line; do
    [[ "${line}" == *"-f ${BUDMON_HOME}/releases/v1.2.0/compose."* ]] || { echo "${line}"; return 1; }
    [[ "${line}" == *"--env-file ${BUDMON_HOME}/releases/v1.2.0/local.env"* ]] || { echo "${line}"; return 1; }
  done < <(compose_calls)

  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.2.0"
  assert_line "previous=v1.1.0"
  [ "$(readlink -f "${BUDMON_HOME}/bin/budmon-local")" = "$(readlink -f "${BUDMON_HOME}/releases/v1.2.0/budmon-local")" ]
}

@test "TP-15.21 (a): no secret value appears in any recorded argument or in stdout" {
  run_phase_b
  assert_success
  refute_output --partial "${CANARY}"
  run grep -F "${CANARY}" "${CALLS}"
  assert_failure
}

@test "TP-15.21 (A-386): phase B's up -d calls run without BUDMON_FIRST_SETUP=1" {
  run_phase_b
  assert_success
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/' '${CALLS}'"
  [ "${#lines[@]}" -ge 2 ] || { echo "${output}"; return 1; }
  refute_output --partial "FIRST_SETUP=1"
}

@test "TP-15.21 (b): migrate failing exits 15 with no up" {
  export MIGRATE_EXIT=1
  run_phase_b
  assert_failure 15
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/ && \$3 !~ / migrate/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (c): readiness never succeeding rolls back to releases/v1.1.0 with BUDMON_TAG=v1.1.0 for both projects, exit 16, state unchanged" {
  export READY_EXIT=1
  run_phase_b
  assert_failure 16
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/ && \$3 ~ /releases\\/v1.1.0\\//' '${CALLS}'"
  assert_output --partial "compose.main.yaml"
  assert_output --partial "compose.capture.yaml"
  assert_output --partial "TAG=v1.1.0"
  refute_output --partial "TAG=v1.2.0"
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.1.0"
  assert_line "previous=v1.0.0"
}

@test "TP-15.21 (d): readiness failing and the rollback up failing too exits 17" {
  export READY_EXIT=1 OLD_UP_EXIT=1
  run_phase_b
  assert_failure 17
}

@test "TP-15.21 (e): with QUEUE_UPGRADE, maintenance is on before migrate, workers are stopped, and the flag is removed at the end" {
  touch "${BUDMON_HOME}/build/v1.2.0/apps/server/QUEUE_UPGRADE"
  run_phase_b
  assert_success
  run cat "${CALLS}.maint"
  assert_output "maint=on"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / stop / && \$3 ~ /worker-general/' '${CALLS}'"
  refute_output ""
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / stop / && \$3 ~ /worker-capture/' '${CALLS}'"
  refute_output ""
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
}

@test "TP-15.21 (e2): without QUEUE_UPGRADE, migrate runs with maintenance off" {
  run_phase_b
  assert_success
  run cat "${CALLS}.maint"
  assert_output "maint=off"
}

@test "TP-15.21 (f): migrate output with migrator_previous_password_used prints the notice" {
  export MIGRATE_OUTPUT='{"level":"warn","event":"migrator_previous_password_used"}'
  run_phase_b
  assert_success
  assert_output --partial "migrator_previous_password_used"
}

@test "TP-15.21 (g): a failing docker build exits 13 with no migrate" {
  export BUILD_EXIT=1
  run_phase_b
  assert_failure 13
  [ ! -s "${CALLS}.maint" ]
}

@test "TP-15.21 (k) (A-423): site.env without WEB_SENTRY_DSN exits 13 (site.env: WEB_SENTRY_DSN not set) with no docker build" {
  sed -i '/^WEB_SENTRY_DSN=/d' "${BUDMON_HOME}/site.env"
  run_phase_b
  assert_failure 13
  assert_output --partial "site.env: WEB_SENTRY_DSN not set"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (k2) (A-423): WEB_SENTRY_DSN=__FILL_ME__ exits 13 with no docker build" {
  sed -i 's|^WEB_SENTRY_DSN=.*|WEB_SENTRY_DSN=__FILL_ME__|' "${BUDMON_HOME}/site.env"
  run_phase_b
  assert_failure 13
  assert_output --partial "site.env: WEB_SENTRY_DSN not set"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (k3) (A-488): a WEB_SENTRY_DSN without a project exits 13, not a valid Sentry DSN, the value not printed, no docker build" {
  sed -i 's|^WEB_SENTRY_DSN=.*|WEB_SENTRY_DSN=https://pub@o1.ingest.sentry.io|' "${BUDMON_HOME}/site.env"
  run_phase_b
  assert_failure 13
  assert_output --partial "site.env: WEB_SENTRY_DSN is not a valid Sentry DSN"
  refute_output --partial "pub@o1.ingest.sentry.io"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (k4) (A-488): a WEB_SENTRY_DSN with a space in the host exits 13, not a valid Sentry DSN, the value not printed, no docker build" {
  sed -i 's|^WEB_SENTRY_DSN=.*|WEB_SENTRY_DSN=https://pub@o1 ingest.sentry.io/2|' "${BUDMON_HOME}/site.env"
  run_phase_b
  assert_failure 13
  assert_output --partial "site.env: WEB_SENTRY_DSN is not a valid Sentry DSN"
  refute_output --partial "pub@o1 ingest"
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (h): 5 existing dumps and 6 release copies: 5 dumps remain including the new one; copies pruned to 5, keeping v1.1.0 and v1.2.0" {
  local d
  for d in 20260901T120000Z 20260902T120000Z 20260903T120000Z 20260904T120000Z 20260905T120000Z; do
    : >"${BUDMON_HOME}/dumps/${d}_v1.0.0.dump"
  done
  : >"${BUDMON_HOME}/dumps/20260801T120000Z_v1.0.0_pre-restore.dump"
  for d in v0.1.0 v0.2.0 v0.3.0 v1.0.0; do make_release "${d}"; done
  run_phase_b
  assert_success
  [ "$(find "${BUDMON_HOME}/dumps" -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z_v[^_]+\.dump' | wc -l)" -eq 5 ]
  [ -n "$(find "${BUDMON_HOME}/dumps" -name '*_v1.1.0.dump')" ]
  refute [ -e "${BUDMON_HOME}/dumps/20260901T120000Z_v1.0.0.dump" ]
  assert [ -e "${BUDMON_HOME}/dumps/20260801T120000Z_v1.0.0_pre-restore.dump" ]
  [ "$(find "${BUDMON_HOME}/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 5 ]
  assert [ -d "${BUDMON_HOME}/releases/v1.1.0" ]
  assert [ -d "${BUDMON_HOME}/releases/v1.2.0" ]
  refute [ -d "${BUDMON_HOME}/releases/v0.1.0" ]
}

@test "TP-15.21 (i): --no-dump makes no pg_dump call" {
  run_phase_b --no-dump
  assert_success
  run bash -c "awk -F'\t' '\$3 ~ /pg_dump/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.21 (j): start through the clone re-executes releases/<current>/budmon-local start; Compose uses the release copy" {
  write_state v1.2.0 v1.1.0
  run "${SCRIPT}" start
  assert_success
  run compose_calls
  refute_output ""
  while IFS= read -r line; do
    [[ "${line}" == *"-f ${BUDMON_HOME}/releases/v1.2.0/compose."* ]] || { echo "${line}"; return 1; }
    [[ "${line}" != *"${LOCAL}/compose."* ]] || { echo "${line}"; return 1; }
    [[ "${line}" == *"REEXEC=1"* ]] || { echo "${line}"; return 1; }
  done < <(compose_calls)
}

# ---- TP-15.37 (A-426): leftover databases, and the refusal over an unfinished restore ----

drops() {
  awk -F'\t' '$1=="sql" && $2 ~ /DROP DATABASE/' "${CALLS}"
}

write_marker() {
  printf 'tag=v1.1.0\nfrom=v1.2.0\nold=budmon_old_20261001T120000Z\nfailed=budmon_restore_failed_20261001T120000Z\n' \
    >"${BUDMON_HOME}/restore.inprogress"
  chmod 0600 "${BUDMON_HOME}/restore.inprogress"
}

@test "TP-15.37 (a): no marker and count(*) 1: both leftover databases are dropped, exit 0" {
  run_phase_b
  assert_success
  run drops
  assert_line --partial 'DROP DATABASE IF EXISTS "budmon_old_20261001T120000Z" WITH (FORCE)'
  assert_line --partial 'DROP DATABASE IF EXISTS "budmon_restore_failed_20261001T120000Z" WITH (FORCE)'
  # A-470: exactly these two, quoted.
  run bash -c "awk -F'\t' '\$1==\"sql\" && \$2 ~ /DROP DATABASE/' '${CALLS}' | wc -l"
  assert_output "2"
}

@test "TP-15.37 (a) (A-470): a listed lower-case name (budmon_old_20261001t120000z) gets no DROP" {
  export EXTRA_LISTED=budmon_old_20261001t120000z
  run_phase_b
  assert_success
  run drops
  refute_output --partial "budmon_old_20261001t120000z"
  assert_line --partial 'DROP DATABASE IF EXISTS "budmon_old_20261001T120000Z" WITH (FORCE)'
}

@test "TP-15.37 (b): restore.inprogress present: nothing dropped, exit 0, leftover databases kept (a restore didn't finish)" {
  write_marker
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_success
  [[ "${stderr}" == *"leftover databases kept: a restore didn't finish (restore.inprogress)"* ]] || { echo "${stderr}"; return 1; }
  run drops
  assert_output ""
}

@test "TP-15.37 (c), (d): count(*) printing 0, or failing: nothing dropped, exit 0, can't confirm budmon exists" {
  local mode
  for mode in zero fail; do
    : >"${CALLS}"
    if [ "${mode}" = zero ]; then export COUNT_OUTPUT=0; unset COUNT_FAIL; else unset COUNT_OUTPUT; export COUNT_FAIL=1; fi
    BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
    [ "${status}" -eq 0 ] || { echo "${mode}: exit ${status}: ${stderr}"; return 1; }
    [[ "${stderr}" == *"leftover databases kept: can't confirm budmon exists"* ]] || { echo "${mode}: ${stderr}"; return 1; }
    run drops
    assert_output ""
  done
}

@test "TP-15.37: with the marker, upgrade and restore exit 27 with no git, docker or pg_dump call; status shows it" {
  write_marker
  mkdir -p "${BUDMON_HOME}/dumps"
  : >"${BUDMON_HOME}/dumps/20261001T120000Z_v1.1.0.dump"
  local cmd
  for cmd in "upgrade v1.2.0" "restore ${BUDMON_HOME}/dumps/20261001T120000Z_v1.1.0.dump"; do
    : >"${CALLS}"
    # shellcheck disable=SC2086 # the command and its argument, split on purpose
    run "${SCRIPT}" ${cmd}
    [ "${status}" -eq 27 ] || { echo "${cmd}: exit ${status}: ${output}"; return 1; }
    assert_output --partial "a restore didn't finish (restore.inprogress)"
    run grep -cE "^(git|docker|pg_dump)"$'\t' "${CALLS}"
    assert_output "0"
  done

  run "${SCRIPT}" status
  assert_success
  assert_output --partial "restore unfinished"
  assert_output --partial "old=budmon_old_20261001T120000Z"
  assert_output --partial "failed=budmon_restore_failed_20261001T120000Z"
}

# ---- TP-15.44 (A-435): migrate's output reaches stderr before the exit-15 line ----

@test "TP-15.44: phase B with migrate failing exits 15; stderr has migrate's line before the reason" {
  export MIGRATE_EXIT=1 MIGRATE_OUTPUT='{"msg":"migration_failed","code":"42P01"}'
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_failure 15
  local line reason
  line="$(grep -n '{"msg":"migration_failed","code":"42P01"}' <<<"${stderr}" | head -n 1 | cut -d: -f1)"
  reason="$(grep -n 'migrate.*failed' <<<"${stderr}" | grep -v migration_failed | head -n 1 | cut -d: -f1)"
  [ -n "${line}" ] && [ -n "${reason}" ] && [ "${line}" -lt "${reason}" ] || { echo "${stderr}"; return 1; }
}


# ---- TP-15.47 (A-502 (2)): a failed start stops at once; never-started containers are recreated ----

# Compose calls of one project (main or capture), each reduced to a label, in order.
project_steps() {
  awk -F'\t' -v p="budmon-$1" '
    $1=="docker" && $3 ~ ("-p " p " ") {
      if ($3 ~ / ps -a --status created --services/) print "created?"
      else if ($3 ~ / rm -f /) print "rm"
      else if ($3 ~ / up -d( |$)/ && $3 !~ / migrate/) print "up"
    }' "${CALLS}"
}

no_readiness_probe() {
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /healthcheck/' '${CALLS}'"
  assert_output ""
}

first_release() {
  rm -f "${BUDMON_HOME}/state"
  make_release v1.0.0
  mkdir -p "${BUDMON_HOME}/build/v1.0.0/apps/server"
}

@test "TP-15.47 (b): _upgrade-continue v1.0.0 --first with capture's up -d failing exits 31 naming budmon-capture; no stop, rm or later up" {
  first_release
  export UP_EXIT_capture=1
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.0.0/budmon-local" _upgrade-continue v1.0.0 --no-dump --first
  assert_failure 31
  [[ "${stderr}" == *"port is already allocated"* ]] || { echo "${stderr}"; return 1; }
  [[ "${stderr}" == *"starting v1.0.0 failed: docker compose up -d for budmon-capture exited 1"* ]] || { echo "${stderr}"; return 1; }
  # Nothing after the failing capture up -d.
  local after
  after="$(awk -F'\t' 'found { print } $1=="docker" && $3 ~ /-p budmon-capture / && $3 ~ / up -d/ { found=1 }' "${CALLS}")"
  [ -z "${after}" ] || { echo "after the failure: ${after}"; return 1; }
  no_readiness_probe
}

@test "TP-15.47 (c): v1.2.0's main up -d failing starts v1.1.0 again (both projects, BUDMON_TAG=v1.1.0) and exits 31; no readiness probe; state unchanged" {
  export UP_EXIT_main=1 UP_EXIT_MATCH="*/releases/v1.2.0/*"
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_failure 31
  [[ "${stderr}" == *"starting v1.2.0 failed: docker compose up -d for budmon-main exited 1; v1.1.0 started again"* ]] || { echo "${stderr}"; return 1; }
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / up -d/ && \$3 !~ / migrate/ && \$3 ~ /releases\\/v1.1.0\\//' '${CALLS}'"
  assert_output --partial "compose.main.yaml"
  assert_output --partial "compose.capture.yaml"
  assert_output --partial "TAG=v1.1.0"
  refute_output --partial "TAG=v1.2.0"
  no_readiness_probe
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.1.0"
  assert_line "previous=v1.0.0"
}

@test "TP-15.47 (d): as (c) with v1.1.0's up -d failing too exits 17 (run budmon-local start)" {
  export UP_EXIT_main=1 UP_EXIT_MATCH="*/releases/v1.2.0/*" OLD_UP_EXIT=1
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_failure 17
  [[ "${stderr}" == *"starting v1.2.0 failed and starting v1.1.0 again failed: run budmon-local start"* ]] || { echo "${stderr}"; return 1; }
}

@test "TP-15.47 (f): a never-started mailpit is removed before main's up -d (phase B --first, then start); capture lists none; no rm has -v" {
  first_release
  export CREATED_main=mailpit
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" _upgrade-continue v1.0.0 --no-dump --first
  assert_success
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" start
  assert_success

  # Per start: main asks for created services, removes them, then starts; capture asks, then starts.
  run project_steps main
  [ "$(tr '\n' ' ' <<<"${output}")" = "created? rm up created? rm up " ] || { echo "main: ${output}"; return 1; }
  run project_steps capture
  [ "$(tr '\n' ' ' <<<"${output}")" = "created? up created? up " ] || { echo "capture: ${output}"; return 1; }
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / rm -f/' '${CALLS}'"
  [ "${#lines[@]}" -eq 2 ] || { echo "${output}"; return 1; }
  for line in "${lines[@]}"; do
    [[ "${line}" == *"-p budmon-main "*" rm -f mailpit"* ]] || { echo "${line}"; return 1; }
    [[ "${line}" != *" -v"* ]] || { echo "rm with -v: ${line}"; return 1; }
  done
}

@test "TP-15.47 (h): mailpit's port published only from the third probe: exit 0 after the third" {
  export PORT_MAILPIT_EMPTY_FOR=2
  run_phase_b
  assert_success
  [ "$(cat "${CALLS}.mailpit-port")" -eq 3 ] || { echo "probes: $(cat "${CALLS}.mailpit-port")"; return 1; }
}

@test "TP-15.47 (h2): mailpit never published: exit 16 within 6 s naming (mailpit not published on 127.0.0.1:8025)" {
  export PORT_MAILPIT="" BUDMON_READY_TIMEOUT=2
  local started=${SECONDS}
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_failure 16
  [ $((SECONDS - started)) -le 6 ] || { echo "took $((SECONDS - started)) s"; return 1; }
  [[ "${stderr}" == *"(mailpit not published on 127.0.0.1:8025)"* ]] || { echo "${stderr}"; return 1; }
}

@test "TP-15.47 (h3): caddy not running: exit 16 naming (caddy not running)" {
  export RUNNING_SERVICES="api worker-general postgres mailpit" BUDMON_READY_TIMEOUT=2
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0
  assert_failure 16
  [[ "${stderr}" == *"(caddy not running)"* ]] || { echo "${stderr}"; return 1; }
}

@test "TP-15.47 (i): start with main's up -d failing exits 31 (Compose's message is above)" {
  write_state v1.2.0 v1.1.0
  export UP_EXIT_main=1
  BUDMON_REEXEC=1 run --separate-stderr "${BUDMON_HOME}/releases/v1.2.0/budmon-local" start
  assert_failure 31
  [[ "${stderr}" == *"starting v1.2.0 failed: docker compose up -d for budmon-main exited 1 (Compose's message is above)"* ]] || { echo "${stderr}"; return 1; }
}
