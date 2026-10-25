#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031,SC2154 # bats: per-test exports, single-quoted awk, run's $stderr
# F-178 `acquire_lock` (A-502 (3)): one budmon-local command at a time. A held lock refuses every
# command but `status`, `logs`, `maintenance status` and the usage text with exit 30, naming the
# holder, before any other action; the lock is inherited by phase A's exec, install step 12's child
# and the re-execution rule's exec; a killed command leaves no stale lock. TP-15.49 (the install
# case of (d) is in install.bats).

bats_require_minimum_version 1.5.0

load helpers

LOCKED="another budmon-local command is running: upgrade pid=4242 since=20261025T101500Z; wait for it to finish"
WEB_DSN="https://pub@o1.ingest.sentry.io/2"

setup() {
  common_setup
  write_state v1.2.0 v1.1.0
  make_release v1.1.0
  make_release v1.2.0
  mkdir -p "${BUDMON_HOME}/dumps" "${BUDMON_HOME}/maintenance" "${BUDMON_HOME}/secrets/main/api"
  printf 'PUBLIC_ORIGIN=https://laptop.tailnet.ts.net\nWEB_SENTRY_DSN=%s\n' "${WEB_DSN}" >"${BUDMON_HOME}/site.env"
  chmod 0600 "${BUDMON_HOME}/site.env"
  # git: phase A's checks pass; worktree add makes a build tree holding the real infra/local, so
  # phase A's exec runs the real phase B (and must inherit the lock). docker as TP-15.21's stub.
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-parse) echo "c0ffee0000000000000000000000000000000001" ;;
    rev-list) echo 42 ;;
    worktree)
      if [ "${args[1]}" = "add" ]; then
        local dir="" a
        for a in "${args[@]:2}"; do case "${a}" in --*) ;; *) [ -z "${dir}" ] && dir="${a}" ;; esac; done
        mkdir -p "${dir}/infra/local" "${dir}/apps/server"
        (cd "${ROOT_FOR_STUBS}/infra/local" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dir}/infra/local" && tar -xf -)
      fi ;;
  esac
  return 0
}
stub_docker() {
  stack_answer "$@" && return "${STACK_EXIT:-0}"
  local all="$*"
  if [ -n "${DOCKER_SLEEP:-}" ]; then /bin/sleep "${DOCKER_SLEEP}"; fi
  if [[ "${all}" == *" pg_dump "* ]]; then
    printf 'PGDMP-fake-dump'
  fi
  return 0
}
stub_sudo() {
  if [ "$1" = "install" ]; then cat >/dev/null; fi
  return 0
}
CONF
  export ROOT_FOR_STUBS="${ROOT}"
}

teardown() {
  if [ -n "${HOLDER:-}" ]; then kill "${HOLDER}" 2>/dev/null || true; fi
  # TP-15.49 (f): the stand-in for git's credential-cache daemon.
  if [ -f "${BATS_TEST_TMPDIR}/daemon.pid" ]; then
    kill "$(cat "${BATS_TEST_TMPDIR}/daemon.pid")" 2>/dev/null || true
  fi
}

LOCK_FILE() { echo "${BUDMON_HOME}/budmon-local.lock"; }

# Holds the lock from another process, with `line` as the holder's description.
hold_lock() {
  printf '%s\n' "$1" >"$(LOCK_FILE)"
  flock "$(LOCK_FILE)" /bin/sleep 30 &
  HOLDER=$!
  # Wait until the background flock holds it.
  local _
  for _ in $(seq 1 50); do
    flock -n "$(LOCK_FILE)" true 2>/dev/null || return 0
    /bin/sleep 0.1
  done
  echo "the holder never took the lock" >&2
  return 1
}

no_side_effects() {
  run bash -c "awk -F'\t' '\$1==\"git\" || \$1==\"docker\" || \$1==\"sudo\" || \$1==\"pnpm\"' '${CALLS}'"
  assert_output ""
}

@test "TP-15.49 (a): with the lock held, every locking command exits 30 within 2 s naming the holder, with no git, docker, sudo or pnpm call" {
  hold_lock "upgrade pid=4242 since=20261025T101500Z"
  local cmd started
  local -a commands=(
    "install v1.0.0"
    "upgrade v1.3.0"
    "_upgrade-continue v1.3.0"
    "restore dumps/20261001T120000Z_v1.1.0.dump"
    "start"
    "stop"
    "restart"
    "maintenance on"
    "maintenance off"
    "secret set main/api/S3_ACCESS_KEY_ID"
    "bootstrap-owner --email o@example.com"
  )
  for cmd in "${commands[@]}"; do
    : >"${CALLS}"
    started=${SECONDS}
    # shellcheck disable=SC2086 # the command's words
    run --separate-stderr bash -c "printf 'v' | '${SCRIPT}' ${cmd}"
    [ "${status}" -eq 30 ] || { echo "${cmd}: exit ${status}: ${stderr}"; return 1; }
    [ $((SECONDS - started)) -le 2 ] || { echo "${cmd}: took $((SECONDS - started)) s"; return 1; }
    [[ "${stderr}" == *"${LOCKED}"* ]] || { echo "${cmd}: ${stderr}"; return 1; }
    no_side_effects
  done
}

@test "TP-15.49 (b): with the lock held, status, logs and maintenance status run as usual (0), and nonsense prints the usage (64)" {
  hold_lock "upgrade pid=4242 since=20261025T101500Z"
  run "${SCRIPT}" status
  assert_success
  run "${SCRIPT}" logs
  assert_success
  run "${SCRIPT}" maintenance status
  assert_success
  run "${SCRIPT}" nonsense
  assert_failure 64
}

@test "TP-15.49 (c): with the lock held and a file holding garbage, start exits 30 without naming a holder" {
  hold_lock "garbage"
  run --separate-stderr "${SCRIPT}" start
  assert_failure 30
  [[ "${stderr}" == *"another budmon-local command is running; wait for it to finish"* ]] || { echo "${stderr}"; return 1; }
  [[ "${stderr}" != *"garbage"* ]] || { echo "${stderr}"; return 1; }
}

lock_line_ok() {
  [ "$(stat -c '%a' "$(LOCK_FILE)")" = 600 ] || { echo "mode $(stat -c '%a' "$(LOCK_FILE)")"; return 1; }
  run cat "$(LOCK_FILE)"
  [ "${#lines[@]}" -eq 1 ] || { echo "${output}"; return 1; }
  [[ "${lines[0]}" =~ ^(upgrade|install|start)\ pid=[0-9]+\ since=[0-9]{8}T[0-9]{6}Z$ ]] || { echo "${output}"; return 1; }
}

@test "TP-15.49 (d): with the lock free, upgrade v1.3.0 (phase A, then its exec of phase B) doesn't exit 30; the lock file is 0600 with one upgrade line" {
  run --separate-stderr "${SCRIPT}" upgrade v1.3.0
  [ "${status}" -ne 30 ] || { echo "${stderr}"; return 1; }
  # Phase B ran: its build of the new tag is recorded.
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^build/' '${CALLS}'"
  refute_output ""
  lock_line_ok
}

@test "TP-15.49 (d): with the lock free, start run from the clone (re-executed from the release copy) doesn't exit 30; one start line" {
  run --separate-stderr "${SCRIPT}" start
  [ "${status}" -ne 30 ] || { echo "${stderr}"; return 1; }
  lock_line_ok
  assert_line --regexp "^start pid="
}

@test "TP-15.49 (e): a command killed with SIGKILL while a docker stub sleeps leaves no stale lock: start doesn't exit 30" {
  export DOCKER_SLEEP=20
  setsid bash -c "BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.2.0/budmon-local' start" >/dev/null 2>&1 &
  local pid=$! _
  for _ in $(seq 1 50); do
    [ -n "$(calls_of docker)" ] && break
    /bin/sleep 0.1
  done
  [ -n "$(calls_of docker)" ] || { echo "start never reached docker"; return 1; }
  # The whole process group, the sleeping docker stub included.
  kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}"
  /bin/sleep 0.5
  unset DOCKER_SLEEP
  run --separate-stderr "${SCRIPT}" start
  [ "${status}" -ne 30 ] || { echo "${stderr}"; return 1; }
}

# A-506 (2): git runs without the lock's fd 9, so a daemon git leaves behind (credential-cache--daemon
# keeps every descriptor it inherits) can't hold the lock after the command ends.
@test "TP-15.49 (f): every git call runs with fd 9 closed; a daemon a git call leaves running doesn't keep the lock, so maintenance on afterwards exits 0" {
  cat >>"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@")
  while [ "${args[0]:-}" = "-C" ]; do args=("${args[@]:2}"); done
  local fd9=closed
  [ -e "/proc/$$/fd/9" ] && fd9=open
  printf '%s fd9=%s\n' "${args[0]:-}" "${fd9}" >>"${CALLS}.git-fd9"
  case "${args[0]:-}" in
    fetch)
      # A stand-in for `git credential-cache--daemon`: it keeps every descriptor but fd 3.
      setsid /bin/sleep 30 </dev/null >/dev/null 2>&1 3>&- &
      echo "$!" >"${BATS_TEST_TMPDIR}/daemon.pid" ;;
    rev-parse) echo "c0ffee0000000000000000000000000000000001" ;;
    rev-list) echo 42 ;;
    worktree)
      if [ "${args[1]}" = "add" ]; then
        local dir="" a
        for a in "${args[@]:2}"; do case "${a}" in --*) ;; *) [ -z "${dir}" ] && dir="${a}" ;; esac; done
        mkdir -p "${dir}/infra/local" "${dir}/apps/server"
        (cd "${ROOT_FOR_STUBS}/infra/local" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dir}/infra/local" && tar -xf -)
      fi ;;
  esac
  return 0
}
CONF
  run --separate-stderr "${SCRIPT}" upgrade v1.3.0
  [ "${status}" -ne 30 ] || { echo "upgrade: ${stderr}"; return 1; }
  [ -f "${BATS_TEST_TMPDIR}/daemon.pid" ] && kill -0 "$(cat "${BATS_TEST_TMPDIR}/daemon.pid")" || {
    echo "the stand-in daemon isn't running"
    return 1
  }

  run cat "${CALLS}.git-fd9"
  local subcommand
  for subcommand in fetch remote merge-base worktree rev-parse; do
    assert_line --regexp "^${subcommand} fd9="
  done
  refute_output --partial "fd9=open"

  run --separate-stderr "${SCRIPT}" maintenance on
  [ "${status}" -eq 0 ] || { echo "maintenance on: exit ${status}: ${stderr}"; return 1; }
}

