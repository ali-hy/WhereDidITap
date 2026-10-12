#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `secret set`. TP-15.28, stub part.

load helpers

setup() {
  common_setup
  write_state v1.0.0 ""
  make_release v1.0.0
  mkdir -p "${BUDMON_HOME}/secrets/main/api" "${BUDMON_HOME}/secrets/capture/worker-capture"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_sudo() {
  # Record what install would read from stdin, by length only.
  if [ "$1" = "install" ]; then printf 'stdin-bytes=%s\n' "$(cat | wc -c)" >>"${CALLS}"; fi
  return 0
}
CONF
}

secret_set() {
  BUDMON_REEXEC=1 "${BUDMON_HOME}/releases/v1.0.0/budmon-local" secret set "$@"
}

@test "TP-15.28: printf v | secret set main/api/S3_ACCESS_KEY_ID writes with sudo install -o 10001 -g 10001 -m 0400 /dev/stdin, the value absent from arguments and stdout" {
  run bash -c "printf 'v-secret-value' | BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.0.0/budmon-local' secret set main/api/S3_ACCESS_KEY_ID"
  assert_success
  assert_output --partial "written main/api/S3_ACCESS_KEY_ID"
  refute_output --partial "v-secret-value"
  run calls_of sudo
  assert_output --partial "install -o 10001 -g 10001 -m 0400 /dev/stdin ${BUDMON_HOME}/secrets/main/api/S3_ACCESS_KEY_ID"
  run grep -F "v-secret-value" "${CALLS}"
  assert_failure
  run grep -c "stdin-bytes=14" "${CALLS}"
  assert_output "1"
}

@test "TP-15.28: secret set capture/worker-capture/GCP_CREDENTIALS from a file writes with owner 10003" {
  printf '{"type":"service_account"}' >"${BATS_TEST_TMPDIR}/key.json"
  run bash -c "BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.0.0/budmon-local' secret set capture/worker-capture/GCP_CREDENTIALS <'${BATS_TEST_TMPDIR}/key.json'"
  assert_success
  run calls_of sudo
  assert_output --partial "install -o 10003 -g 10003 -m 0400 /dev/stdin ${BUDMON_HOME}/secrets/capture/worker-capture/GCP_CREDENTIALS"
}

@test "TP-15.28: secret set main/api/GCP_CREDENTIALS (not in F-191's table for api) exits 64" {
  run bash -c "printf 'v' | BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.0.0/budmon-local' secret set main/api/GCP_CREDENTIALS"
  assert_failure 64
  run calls_of sudo
  assert_output ""
}

@test "TP-15.28: secret set ../x/KEY exits 64" {
  run bash -c "printf 'v' | BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.0.0/budmon-local' secret set ../x/KEY"
  assert_failure 64
  run calls_of sudo
  assert_output ""
}

@test "TP-15.28: empty stdin exits 22 and writes nothing" {
  run bash -c "BUDMON_REEXEC=1 '${BUDMON_HOME}/releases/v1.0.0/budmon-local' secret set main/api/S3_ACCESS_KEY_ID </dev/null"
  assert_failure 22
  run calls_of sudo
  assert_output ""
}
