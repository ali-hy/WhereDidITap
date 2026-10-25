# shellcheck shell=bash
# budmon-local (F-178): shared paths, messages, settings, state and the Compose wrapper.
# Sourced by budmon-local; every function assumes `set -euo pipefail`.

# The server image's base, used by install's permission probe (F-178 step 8). It must equal the
# FROM line of images/server/Dockerfile.
# shellcheck disable=SC2034 # used by budmon-local
SERVER_BASE_IMAGE="node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20"
# shellcheck disable=SC2034 # used by the other libraries
PLACEHOLDER="__FILL_ME__"
# shellcheck disable=SC2034 # used by the other libraries
TAG_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+(-hotfix\.[0-9]+)?$'

: "${BUDMON_HOME:=${HOME}/.budmon}"
: "${BUDMON_REPO:=${HOME}/src/budmon}"
export BUDMON_HOME BUDMON_REPO

die() {
  local code="$1"
  shift
  echo "budmon-local: $*" >&2
  exit "${code}"
}

say() {
  echo "budmon-local: $*"
}

usage() {
  cat >&2 <<'USAGE'
usage: budmon-local <command>
  install <tag>                      first installation (resumable)
  upgrade <tag> [--no-dump]          build, migrate and start a release
  start | stop | restart | status    the running release's stack
  logs [-f] [service]                the last 200 log lines
  maintenance on|off|status          the maintenance flag
  secret set <role>/<service>/<KEY> [--empty]
                                     write one secret file from stdin; --empty (no SMTP
                                     authentication) only for main/worker-general/SMTP_PASSWORD
  restore <dump file>                restore a dump with the release that wrote it
  bootstrap-owner --email <address> [--replace]
USAGE
  exit 64
}

# A-387: test overrides for the waits, positive integer seconds.
positive_int() {
  local name="$1" value="$2"
  [[ "${value}" =~ ^[1-9][0-9]*$ ]] || die 64 "${name} must be a positive integer"
}
PG_READY_TIMEOUT="${BUDMON_PG_READY_TIMEOUT:-60}"
READY_TIMEOUT="${BUDMON_READY_TIMEOUT:-120}"
RENAME_RETRY_DELAY="${BUDMON_RENAME_RETRY_DELAY:-2}"
check_settings() {
  positive_int BUDMON_PG_READY_TIMEOUT "${PG_READY_TIMEOUT}"
  positive_int BUDMON_READY_TIMEOUT "${READY_TIMEOUT}"
  positive_int BUDMON_RENAME_RETRY_DELAY "${RENAME_RETRY_DELAY}"
}

utc_stamp() {
  date -u +%Y%m%dT%H%M%SZ
}

# A-502 (3): one budmon-local command at a time. A non-blocking flock on fd 9; the lock is
# inherited (BUDMON_LOCK_HELD=1 with fd 9 still the lock file) by phase A's exec of
# _upgrade-continue, install's step-12 child and the re-execution rule's exec. It never waits,
# and it ends with the last process holding fd 9, so a crash or kill leaves no stale lock.
acquire_lock() {
  local lock="${BUDMON_HOME}/budmon-local.lock" line
  if [ "${BUDMON_LOCK_HELD:-}" = 1 ] && [ /proc/$$/fd/9 -ef "${lock}" ]; then
    return 0
  fi
  if [ ! -d "${BUDMON_HOME}" ]; then
    mkdir -p "${BUDMON_HOME}"
    chmod 0700 "${BUDMON_HOME}"
  fi
  exec 9>>"${lock}"
  chmod 0600 "${lock}"
  if ! flock -n 9; then
    line="$(head -n 1 "${lock}" 2>/dev/null || true)"
    if [[ "${line}" =~ ^[a-z_-]+(\ [a-z]+)?\ pid=[0-9]+\ since=[0-9]{8}T[0-9]{6}Z$ ]]; then
      die 30 "another budmon-local command is running: ${line}; wait for it to finish"
    fi
    die 30 "another budmon-local command is running; wait for it to finish"
  fi
  : >"${lock}"
  printf '%s pid=%s since=%s\n' "$*" "$$" "$(utc_stamp)" >&9
  export BUDMON_LOCK_HELD=1
}

# ---- state ----

state_get() {
  local key="$1"
  [ -f "${BUDMON_HOME}/state" ] || return 0
  sed -n "s/^${key}=//p" "${BUDMON_HOME}/state" | head -n 1
}

state_write() {
  local current="$1" previous="$2" tmp
  tmp="$(mktemp "${BUDMON_HOME}/.state.XXXXXX")"
  printf 'current=%s\nprevious=%s\n' "${current}" "${previous}" >"${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "${BUDMON_HOME}/state"
}

link_bin() {
  local tag="$1"
  mkdir -p "${BUDMON_HOME}/bin"
  ln -sfn "${BUDMON_HOME}/releases/${tag}/budmon-local" "${BUDMON_HOME}/bin/budmon-local"
}

release_dir() {
  echo "${BUDMON_HOME}/releases/$1"
}

# A value from a release copy's local.env.
local_env_get() {
  local tag="$1" key="$2"
  sed -n "s/^${key}=//p" "$(release_dir "${tag}")/local.env" | head -n 1
}

# ---- Compose ----

# compose_for <tag> <main|capture> <args…>: docker compose with the release copy's files, as F-178
# runs every Compose call, with BUDMON_TAG=<tag> and BUDMON_HOME exported.
compose_for() {
  local tag="$1" project="$2"
  shift 2
  local r
  r="$(release_dir "${tag}")"
  BUDMON_TAG="${tag}" docker compose --project-directory "${r}" -p "budmon-${project}" \
    -f "${r}/compose.${project}.yaml" --env-file "${r}/local.env" "$@"
}

# psql as budmon_admin over the Postgres container's socket (peer authentication); the statement
# goes on stdin.
admin_sql() {
  local tag="$1" sql="$2"
  printf '%s\n' "${sql}" | compose_for "${tag}" main exec -T -u postgres postgres \
    psql -v ON_ERROR_STOP=1 -X -q -U budmon_admin -d postgres -At
}

# A-433: a SECONDS deadline; probe at least once, sleep 1 s after a failed probe.
wait_postgres() {
  local tag="$1" deadline=$((SECONDS + PG_READY_TIMEOUT))
  while :; do
    if compose_for "${tag}" main exec -T -u postgres postgres pg_isready -U budmon_admin \
      >/dev/null 2>&1 </dev/null; then
      return 0
    fi
    [ "${SECONDS}" -lt "${deadline}" ] || return 1
    sleep 1
  done
}

# ---- restore.inprogress (A-426) ----

restore_marker() {
  echo "${BUDMON_HOME}/restore.inprogress"
}

# Exit 27 while a restore hasn't finished (restore step 0, upgrade phase A step 0).
refuse_unfinished_restore() {
  if [ -e "$(restore_marker)" ]; then
    die 27 "a restore didn't finish (restore.inprogress): see the runbook (A restore didn't finish)"
  fi
  return 0
}
