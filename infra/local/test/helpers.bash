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
exit 0
STUB
    chmod +x "${STUB_DIR}/${cmd}"
  done
  export PATH="${STUB_DIR}:${PATH}"
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

