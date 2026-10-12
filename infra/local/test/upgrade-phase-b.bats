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

load helpers

CANARY="CANARY-secret-tp-15-21-7f3a"

setup() {
  common_setup
  write_state v1.1.0 v1.0.0
  make_release v1.1.0
  make_release v1.2.0
  mkdir -p "${BUDMON_HOME}/build/v1.2.0/apps/server" "${BUDMON_HOME}/dumps" "${BUDMON_HOME}/maintenance"
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
  return 0
}
CONF
}

run_phase_b() {
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.2.0/budmon-local" _upgrade-continue v1.2.0 "$@"
}

compose_calls() {
  calls_of docker | grep -F ' compose '
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
