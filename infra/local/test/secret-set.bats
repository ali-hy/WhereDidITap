#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `secret set`. TP-15.28, stub part. A-537: `rm -f <path>`, then `install … /dev/stdin <path>`.

load helpers

bats_require_minimum_version 1.5.0

setup() {
  common_setup
  write_state v1.0.0 ""
  make_release v1.0.0
  mkdir -p "${BUDMON_HOME}/secrets/main/api" "${BUDMON_HOME}/secrets/capture/worker-capture"
  # SUDO_FAIL_ON=rm|install: that sudo call exits 1 (install only after reading stdin).
  cat >"${STUB_CONFIG}" <<'CONF'
stub_sudo() {
  # Record what install reads from stdin, by length only.
  if [ "$1" = "install" ] && [[ " $* " == *" /dev/stdin "* ]]; then
    printf 'stdin-bytes=%s\n' "$(cat | wc -c)" >>"${CALLS}"
  fi
  [ "$1" = "${SUDO_FAIL_ON:-}" ] && return 1
  return 0
}
CONF
}

BIN() { echo "${BUDMON_HOME}/releases/v1.0.0/budmon-local"; }

# The recorded sudo calls' arguments, one per line, in order.
sudo_args() {
  awk -F'\t' '$1 == "sudo" { print $3 }' "${CALLS}"
}

# The recorded stdin byte counts, one per line.
stdin_bytes() {
  grep '^stdin-bytes=' "${CALLS}" || true
}

# Fails unless "$stderr" has a line exactly equal to $1.
stderr_has_line() {
  local l
  for l in "${stderr_lines[@]}"; do [ "${l}" = "$1" ] && return 0; done
  echo "stderr has no line: $1"
  echo "stderr: ${stderr}"
  return 1
}

S3=main/api/S3_ACCESS_KEY_ID
VALUE=v-secret-value

@test "TP-15.28 (A-537): printf v | secret set ${S3}: sudo rm -f, then sudo install -o 10001 -g 10001 -m 0400 /dev/stdin on the same path; only install reads stdin; the value never in arguments or output" {
  run --separate-stderr bash -c "printf '%s' '${VALUE}' | BUDMON_REEXEC=1 '$(BIN)' secret set ${S3}"
  assert_success
  assert_line "written ${S3}"
  refute_output --partial "${VALUE}"
  [[ "${stderr}" != *"${VALUE}"* ]] || { echo "stderr: ${stderr}"; return 1; }

  local path="${BUDMON_HOME}/secrets/${S3}"
  run sudo_args
  assert_equal "${#lines[@]}" 2
  assert_equal "${lines[0]}" "rm -f ${path}"
  assert_equal "${lines[1]}" "install -o 10001 -g 10001 -m 0400 /dev/stdin ${path}"
  run grep -F "${VALUE}" "${CALLS}"
  assert_failure
  run stdin_bytes
  assert_output "stdin-bytes=14"
}

@test "TP-15.28 (A-537): secret set capture/worker-capture/GCP_CREDENTIALS from a file: sudo rm -f, then install with owner 10003" {
  printf '{"type":"service_account"}' >"${BATS_TEST_TMPDIR}/key.json"
  run --separate-stderr bash -c "BUDMON_REEXEC=1 '$(BIN)' secret set capture/worker-capture/GCP_CREDENTIALS <'${BATS_TEST_TMPDIR}/key.json'"
  assert_success
  assert_line "written capture/worker-capture/GCP_CREDENTIALS"

  local path="${BUDMON_HOME}/secrets/capture/worker-capture/GCP_CREDENTIALS"
  run sudo_args
  assert_equal "${#lines[@]}" 2
  assert_equal "${lines[0]}" "rm -f ${path}"
  assert_equal "${lines[1]}" "install -o 10003 -g 10003 -m 0400 /dev/stdin ${path}"
  run grep -F "service_account" "${CALLS}"
  assert_failure
  run stdin_bytes
  assert_output "stdin-bytes=26"
}

@test "TP-15.28: secret set main/api/GCP_CREDENTIALS (not in F-191's table for api) exits 64, no sudo call" {
  run bash -c "printf 'v' | BUDMON_REEXEC=1 '$(BIN)' secret set main/api/GCP_CREDENTIALS"
  assert_failure 64
  run sudo_args
  assert_output ""
}

@test "TP-15.28: secret set ../x/KEY exits 64, no sudo call" {
  run bash -c "printf 'v' | BUDMON_REEXEC=1 '$(BIN)' secret set ../x/KEY"
  assert_failure 64
  run sudo_args
  assert_output ""
}

@test "TP-15.28: empty stdin exits 22 with no sudo call (no rm, nothing written)" {
  run bash -c "BUDMON_REEXEC=1 '$(BIN)' secret set ${S3} </dev/null"
  assert_failure 22
  run sudo_args
  assert_output ""
}

# ---- A-537: failures ----

@test "TP-15.28 (A-537 f1): sudo rm failing: exit 1, 'writing ${S3} failed; nothing written', no install, no written" {
  export SUDO_FAIL_ON=rm
  run --separate-stderr bash -c "printf '%s' '${VALUE}' | BUDMON_REEXEC=1 '$(BIN)' secret set ${S3}"
  assert_failure 1
  stderr_has_line "budmon-local: writing ${S3} failed; nothing written"
  refute_output --partial "written"
  refute_output --partial "${VALUE}"
  [[ "${stderr}" != *"${VALUE}"* ]] || { echo "stderr: ${stderr}"; return 1; }

  run sudo_args
  assert_output "rm -f ${BUDMON_HOME}/secrets/${S3}"
  run stdin_bytes
  assert_output ""
  run grep -F "${VALUE}" "${CALLS}"
  assert_failure
}

@test "TP-15.28 (A-537 f2): sudo install failing after reading stdin: exit 1, 'writing ${S3} failed after removing any old value; run the same command again', no written" {
  export SUDO_FAIL_ON=install
  run --separate-stderr bash -c "printf '%s' '${VALUE}' | BUDMON_REEXEC=1 '$(BIN)' secret set ${S3}"
  assert_failure 1
  stderr_has_line "budmon-local: writing ${S3} failed after removing any old value; run the same command again"
  refute_output --partial "written"
  refute_output --partial "${VALUE}"
  [[ "${stderr}" != *"${VALUE}"* ]] || { echo "stderr: ${stderr}"; return 1; }

  local path="${BUDMON_HOME}/secrets/${S3}"
  run sudo_args
  assert_equal "${#lines[@]}" 2
  assert_equal "${lines[0]}" "rm -f ${path}"
  assert_equal "${lines[1]}" "install -o 10001 -g 10001 -m 0400 /dev/stdin ${path}"
  run grep -F "${VALUE}" "${CALLS}"
  assert_failure
}

# ---- A-487: --empty, for main/worker-general/SMTP_PASSWORD only ----

SMTP=main/worker-general/SMTP_PASSWORD

@test "TP-15.28 (A-487, A-537): secret set ${SMTP} --empty (stdin v not read): the only sudo call is install -o 10002 -g 10002 -m 0400 /dev/null, exit 0" {
  mkdir -p "${BUDMON_HOME}/secrets/main/worker-general"
  run --separate-stderr bash -c "printf 'v' | BUDMON_REEXEC=1 '$(BIN)' secret set ${SMTP} --empty"
  assert_success
  assert_line "written ${SMTP} (empty: no SMTP authentication)"
  run sudo_args
  assert_output "install -o 10002 -g 10002 -m 0400 /dev/null ${BUDMON_HOME}/secrets/${SMTP}"
}

@test "TP-15.28 (A-487, A-537): secret set --empty ${SMTP} (flag first): the same single install, exit 0" {
  mkdir -p "${BUDMON_HOME}/secrets/main/worker-general"
  run --separate-stderr bash -c "BUDMON_REEXEC=1 '$(BIN)' secret set --empty ${SMTP} </dev/null"
  assert_success
  assert_line "written ${SMTP} (empty: no SMTP authentication)"
  run sudo_args
  assert_output "install -o 10002 -g 10002 -m 0400 /dev/null ${BUDMON_HOME}/secrets/${SMTP}"
}

@test "TP-15.28 (A-487): --empty on main/api/DB_PASSWORD exits 64 naming the only allowed path, no sudo call" {
  run bash -c "printf 'v' | BUDMON_REEXEC=1 '$(BIN)' secret set main/api/DB_PASSWORD --empty"
  assert_failure 64
  assert_output --partial "--empty is only allowed for main/worker-general/SMTP_PASSWORD"
  run sudo_args
  assert_output ""
}

@test "TP-15.28 (A-487): empty stdin to ${SMTP} without --empty still exits 22, no sudo call" {
  mkdir -p "${BUDMON_HOME}/secrets/main/worker-general"
  run bash -c "BUDMON_REEXEC=1 '$(BIN)' secret set ${SMTP} </dev/null"
  assert_failure 22
  run sudo_args
  assert_output ""
}

@test "TP-15.28 (A-487): secret set ${SMTP} --empty x (an extra argument) exits 64, no sudo call" {
  mkdir -p "${BUDMON_HOME}/secrets/main/worker-general"
  run bash -c "BUDMON_REEXEC=1 '$(BIN)' secret set ${SMTP} --empty x </dev/null"
  assert_failure 64
  run sudo_args
  assert_output ""
}
