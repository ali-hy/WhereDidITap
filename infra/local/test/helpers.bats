#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# The bats harness itself (test tooling, extra cases TP-15.32x; IDs ending in "x" are
# test-architect additions): stubs record their calls and run per-test behaviour.

load helpers

setup() {
  common_setup
}

@test "TP-15.32x: a stub records command, working directory, arguments, BUDMON_REEXEC, BUDMON_TAG and BUDMON_FIRST_SETUP" {
  (cd "${BATS_TEST_TMPDIR}" && BUDMON_REEXEC=1 BUDMON_TAG=v9.9.9 BUDMON_FIRST_SETUP=1 docker compose ps)
  run cat "${CALLS}"
  assert_output "docker	${BATS_TEST_TMPDIR}	compose ps	REEXEC=1	TAG=v9.9.9	FIRST_SETUP=1"
}

@test "TP-15.32x: a stub_<command> function in STUB_CONFIG decides the exit code and output" {
  echo 'stub_git() { echo "hello $1"; return 7; }' >"${STUB_CONFIG}"
  run git world
  assert_failure 7
  assert_output "hello world"
}

@test "TP-15.32x: make_release copies infra/local without test/ and writes RELEASE" {
  make_release v0.0.1 abc
  refute [ -e "${BUDMON_HOME}/releases/v0.0.1/test" ]
  run cat "${BUDMON_HOME}/releases/v0.0.1/RELEASE"
  assert_line "tag=v0.0.1"
  assert_line "commit=abc"
}

@test "TP-15.32x: fake_init_local writes F-191's placeholders, and fill_placeholders fills them" {
  fake_init_local "${BUDMON_HOME}"
  run grep -rlx "__FILL_ME__" "${BUDMON_HOME}/secrets"
  assert_output --partial "main/api/S3_ACCESS_KEY_ID"
  fill_placeholders
  run grep -rlx "__FILL_ME__" "${BUDMON_HOME}/secrets"
  assert_failure
}
