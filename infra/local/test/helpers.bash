# Shared set-up for the budmon-local bats suites (test-architect, §10.1 Bash).
#
# Every external command the script uses (git, docker, pg_dump, pg_restore, gcloud, openssl, curl,
# sudo, pnpm, tailscale) is a stub on PATH that appends one tab-separated line to "$CALLS":
#   <command> <TAB> <working directory> <TAB> <arguments joined by spaces> <TAB> REEXEC=<BUDMON_REEXEC>
#   <TAB> TAG=<BUDMON_TAG> <TAB> FIRST_SETUP=<BUDMON_FIRST_SETUP> (A-386: Compose interpolates it)
# `sleep` is stubbed too, so waits that poll with sleep finish at once.
# and then runs a function `stub_<command>` from "$STUB_CONFIG" when a test defines one (its exit
# code is the stub's), or exits 0. Tests define behaviour by writing functions into "$STUB_CONFIG".

ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/../../.." && pwd)"
LOCAL="${ROOT}/infra/local"
# shellcheck disable=SC2034 # used by the .bats files that load this
SCRIPT="${LOCAL}/budmon-local"

load "${ROOT}/.tools/bats/bats-support/load"
load "${ROOT}/.tools/bats/bats-assert/load"

STUBBED=(git docker pg_dump pg_restore gcloud openssl curl sudo pnpm tailscale sleep df)

common_setup() {
  export BUDMON_HOME="${BATS_TEST_TMPDIR}/home"
  export BUDMON_REPO="${BATS_TEST_TMPDIR}/repo"
  export CALLS="${BATS_TEST_TMPDIR}/calls.log"
  export STUB_CONFIG="${BATS_TEST_TMPDIR}/stubs.bash"
  export STUB_DIR="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "${BUDMON_HOME}" "${BUDMON_REPO}" "${STUB_DIR}"
  chmod 0700 "${BUDMON_HOME}"
  : >"${CALLS}"
  : >"${STUB_CONFIG}"
  for cmd in "${STUBBED[@]}"; do
    cat >"${STUB_DIR}/${cmd}" <<'STUB'
#!/usr/bin/env bash
name="$(basename "$0")"
printf '%s\t%s\t%s\tREEXEC=%s\tTAG=%s\tFIRST_SETUP=%s\n' "${name}" "${PWD}" "$*" "${BUDMON_REEXEC:-}" "${BUDMON_TAG:-}" "${BUDMON_FIRST_SETUP:-}" >>"${CALLS}"
if [ -f "${STUB_CONFIG}" ]; then
  # shellcheck disable=SC1090
  source "${STUB_CONFIG}"
fi
if declare -F "stub_${name}" >/dev/null; then
  "stub_${name}" "$@"
  exit $?
fi
# A-502 (2): without a test's own docker stub, the stack answers the start and readiness queries.
if [ "${name}" = docker ] && declare -F stack_answer >/dev/null && stack_answer "$@"; then
  exit "${STACK_EXIT:-0}"
fi
exit 0
STUB
    chmod +x "${STUB_DIR}/${cmd}"
  done
  export PATH="${STUB_DIR}:${PATH}"
  # Stubs run as their own processes; let a stub_<cmd> call the fake F-191 helpers.
  export -f fake_init_local fill_placeholders stack_answer
  unset BUDMON_REEXEC BUDMON_FIRST_SETUP BUDMON_PG_READY_TIMEOUT BUDMON_READY_TIMEOUT BUDMON_RENAME_RETRY_DELAY
}

# Lines of $CALLS for one command.
calls_of() {
  awk -F'\t' -v c="$1" '$1 == c' "${CALLS}"
}

# Writes BUDMON_HOME/state.
write_state() {
  printf 'current=%s\nprevious=%s\n' "$1" "${2:-}" >"${BUDMON_HOME}/state"
  chmod 0600 "${BUDMON_HOME}/state"
}

# A release copy: the real infra/local without test/ and rehearsal/, plus RELEASE, and a marker
# file naming the tag so tests can tell copies apart.
make_release() {
  local tag="$1" commit="${2:-0000000000000000000000000000000000000000}"
  local dir="${BUDMON_HOME}/releases/${tag}"
  mkdir -p "${dir}"
  (cd "${LOCAL}" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dir}" && tar -xf -)
  printf 'tag=%s\ncommit=%s\n' "${tag}" "${commit}" >"${dir}/RELEASE"
  printf '%s\n' "${tag}" >"${dir}/MARKER"
}

# A recording stand-in for a release copy's budmon-local (for phase A's exec).
recording_budmon_local() {
  cat >"$1" <<'REC'
#!/usr/bin/env bash
printf 'budmon-local\t%s\t%s\tREEXEC=%s\tpath=%s\n' "${PWD}" "$*" "${BUDMON_REEXEC:-}" "$0" >>"${CALLS}"
exit 0
REC
  chmod +x "$1"
}

# The files F-191 writes, with its placeholders (for a pnpm stub standing in for
# `budmonctl secrets init-local --home <home>`).
fake_init_local() {
  local home="$1" s
  s="${home}/secrets"
  mkdir -p "${s}/main/api" "${s}/main/worker-general" "${s}/main/migrate" "${s}/main/postgres" \
    "${s}/capture/worker-capture"
  local f
  for f in DB_PASSWORD CURSOR_KEY RATE_LIMIT_HMAC_KEY API_SECRETS_KEYS RECOVERY_CODE_HMAC_KEYS; do
    echo "generated-${f}" >"${s}/main/api/${f}"
  done
  for f in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY CAPTURE_PUBLIC_KEY GOOGLE_SIGNIN_CLIENT_SECRET; do
    echo "__FILL_ME__" >"${s}/main/api/${f}"
  done
  for f in DB_PASSWORD QUEUE_DB_PASSWORD; do echo "generated-${f}" >"${s}/main/worker-general/${f}"; done
  : >"${s}/main/worker-general/SMTP_PASSWORD"
  for f in S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY FX_PRIMARY_APP_ID CAPTURE_PUBLIC_KEY; do
    echo "__FILL_ME__" >"${s}/main/worker-general/${f}"
  done
  echo "generated" >"${s}/main/migrate/DB_PASSWORD"
  echo "{}" >"${s}/main/migrate/ROLE_SECRETS"
  echo "generated" >"${s}/main/postgres/ADMIN_PASSWORD"
  echo "SCRAM-SHA-256\$4096:x" >"${s}/main/postgres/MIGRATOR_VERIFIER"
  echo "generated" >"${s}/capture/worker-capture/DB_PASSWORD"
  echo "generated" >"${s}/capture/worker-capture/MAILBOX_HMAC_KEY"
  for f in GCP_CREDENTIALS GOOGLE_OAUTH_CLIENT_SECRET CAPTURE_PUBLIC_KEY; do
    echo "__FILL_ME__" >"${s}/capture/worker-capture/${f}"
  done
  : >"${s}/.initialised"
}

# Fills every placeholder file (as the owner would with `secret set`).
fill_placeholders() {
  local f
  while IFS= read -r f; do echo "filled" >"${f}"; done < <(grep -rlx "__FILL_ME__" "${BUDMON_HOME}/secrets")
}


# A-502 (2): the stack's answers to the calls `up_project`/`up_both` and `wait_ready` make, so every
# suite's docker stub can start with `stack_answer "$@" && return "${STACK_EXIT:-0}"`. It returns 0
# (and prints the answer) when it handled the call, else 1. Knobs (environment):
#   CREATED_main, CREATED_capture   services `ps -a --status created --services` lists (default none)
#   RUNNING_SERVICES                what `ps --status running --services` lists
#                                   (default: caddy api worker-general postgres mailpit)
#   PORT_CADDY, PORT_MAILPIT        what `port caddy 8080` / `port mailpit 8025` print
#                                   (default 127.0.0.1:8080 / 127.0.0.1:8025; set empty for nothing)
#   PORT_MAILPIT_EMPTY_FOR=n        `port mailpit 8025` prints nothing for the first n calls
#   FAILED_main, FAILED_capture     A-507: services whose container is `exited` with a start error;
#   STOPPED_main, STOPPED_capture   and those `exited` by `stop`. `ps -a --status exited -q` lists
#                                   one ID per service (FAILED_ first, then STOPPED_), `cid-<p>-<s>`;
#                                   `container inspect` prints, per ID argument, the service for a
#                                   FAILED_ ID and an empty line for a STOPPED_ one (default: none)
#   EXITED_PS_FAIL=1                that `ps -a --status exited -q` prints nothing and exits 1
#   INSPECT_EXIT                    `container inspect`'s exit status after printing (default 0)
#   UP_EXIT_main, UP_EXIT_capture   exit status of that project's `up -d` (default 0), optionally
#   UP_EXIT_MATCH                   only for calls whose " <arguments> " match this glob; a non-zero
#                                   status prints Compose's port-allocated message on stderr
# shellcheck disable=SC2034 # STACK_EXIT is read by the calling stub
stack_answer() {
  local all=" $* " project=""
  STACK_EXIT=0
  case "${all}" in
    *" -p budmon-main "*) project=main ;;
    *" -p budmon-capture "*) project=capture ;;
  esac
  case "${all}" in
    *" ps -a --status created --services "*)
      local created_var="CREATED_${project}"
      local s
      for s in ${!created_var:-}; do echo "${s}"; done
      return 0
      ;;
    *" ps -a --status exited -q "*)
      if [ "${EXITED_PS_FAIL:-0}" = 1 ]; then
        STACK_EXIT=1
        return 0
      fi
      local failed_var="FAILED_${project}" stopped_var="STOPPED_${project}" s
      for s in ${!failed_var:-} ${!stopped_var:-}; do echo "cid-${project}-${s}"; done
      return 0
      ;;
    *" container inspect "*)
      local a id_project id_service failed_list
      for a in "$@"; do
        [[ "${a}" == cid-* ]] || continue
        id_project="${a#cid-}"
        id_project="${id_project%%-*}"
        id_service="${a#cid-"${id_project}"-}"
        failed_list="FAILED_${id_project}"
        if [[ " ${!failed_list:-} " == *" ${id_service} "* ]]; then echo "${id_service}"; else echo ""; fi
      done
      STACK_EXIT="${INSPECT_EXIT:-0}"
      return 0
      ;;
    *" ps --status running --services "*)
      local s
      for s in ${RUNNING_SERVICES-caddy api worker-general postgres mailpit}; do echo "${s}"; done
      return 0
      ;;
    *" port caddy 8080 "*)
      [ -n "${PORT_CADDY-127.0.0.1:8080}" ] && echo "${PORT_CADDY-127.0.0.1:8080}"
      return 0
      ;;
    *" port mailpit 8025 "*)
      local n=0
      n=$(( $(cat "${CALLS}.mailpit-port" 2>/dev/null || echo 0) + 1 ))
      echo "${n}" >"${CALLS}.mailpit-port"
      if [ "${n}" -le "${PORT_MAILPIT_EMPTY_FOR:-0}" ]; then return 0; fi
      [ -n "${PORT_MAILPIT-127.0.0.1:8025}" ] && echo "${PORT_MAILPIT-127.0.0.1:8025}"
      return 0
      ;;
    *" up -d"*)
      [ -n "${project}" ] || return 1
      local up_var="UP_EXIT_${project}"
      local code="${!up_var:-0}"
      [ "${code}" != 0 ] || return 1
      # shellcheck disable=SC2053 # UP_EXIT_MATCH is a glob pattern on purpose
      if [ -n "${UP_EXIT_MATCH:-}" ] && [[ "${all}" != ${UP_EXIT_MATCH} ]]; then return 1; fi
      echo "Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint budmon-${project}-mailpit-1: Bind for 127.0.0.1:8025 failed: port is already allocated" >&2
      STACK_EXIT="${code}"
      return 0
      ;;
  esac
  return 1
}
