#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031,SC2154 # bats: per-test exports, single-quoted awk, run's $stderr
# F-178 commands that need an installation refuse without `state` (A-502 (4)): `upgrade` and
# `_upgrade-continue` (without --first) exit 2 before any git, docker or pnpm call, also while an
# install is unfinished; `maintenance` and `secret set` keep working. TP-15.50 (the install case,
# a flag set before install, is in install.bats).

bats_require_minimum_version 1.5.0

load helpers

NOT_INSTALLED="not installed: run budmon-local install <tag>"

setup() {
  common_setup
  mkdir -p "${BUDMON_HOME}/secrets/main/api"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_sudo() {
  if [ "$1" = "install" ]; then cat >/dev/null; fi
  return 0
}
CONF
}

no_git_docker_pnpm() {
  run bash -c "awk -F'\t' '\$1==\"git\" || \$1==\"docker\" || \$1==\"pnpm\"' '${CALLS}'"
  assert_output ""
}

unfinished_install() {
  printf 'tag=v1.0.0\n' >"${BUDMON_HOME}/install.inprogress"
  chmod 0600 "${BUDMON_HOME}/install.inprogress"
}

@test "TP-15.50: an empty home: upgrade v1.2.0 exits 2 (not installed) with no git, docker or pnpm call" {
  run --separate-stderr "${SCRIPT}" upgrade v1.2.0
  assert_failure 2
  [[ "${stderr}" == *"${NOT_INSTALLED}"* ]] || { echo "${stderr}"; return 1; }
  no_git_docker_pnpm
}

@test "TP-15.50: an empty home: _upgrade-continue v1.2.0 exits 2 (not installed) with no git, docker or pnpm call" {
  BUDMON_REEXEC=1 run --separate-stderr "${SCRIPT}" _upgrade-continue v1.2.0
  assert_failure 2
  [[ "${stderr}" == *"${NOT_INSTALLED}"* ]] || { echo "${stderr}"; return 1; }
  no_git_docker_pnpm
}

@test "TP-15.50: a home with only install.inprogress: upgrade and _upgrade-continue exit 2 (not installed), no git, docker or pnpm call" {
  unfinished_install
  run --separate-stderr "${SCRIPT}" upgrade v1.2.0
  assert_failure 2
  [[ "${stderr}" == *"${NOT_INSTALLED}"* ]] || { echo "${stderr}"; return 1; }
  BUDMON_REEXEC=1 run --separate-stderr "${SCRIPT}" _upgrade-continue v1.2.0
  assert_failure 2
  [[ "${stderr}" == *"${NOT_INSTALLED}"* ]] || { echo "${stderr}"; return 1; }
  no_git_docker_pnpm
}

@test "TP-15.50: control: _upgrade-continue v1.2.0 --first doesn't exit 2" {
  BUDMON_REEXEC=1 run "${SCRIPT}" _upgrade-continue v1.2.0 --first
  [ "${status}" -ne 2 ] || { echo "${output}"; return 1; }
}

@test "TP-15.50: without state, maintenance on, status and off exit 0 and create, report and remove the flag" {
  local home
  for home in empty unfinished; do
    [ "${home}" = unfinished ] && unfinished_install
    BUDMON_REEXEC=1 run "${SCRIPT}" maintenance on
    assert_success
    [ -f "${BUDMON_HOME}/maintenance/on" ] || { echo "${home}: no flag"; return 1; }
    BUDMON_REEXEC=1 run "${SCRIPT}" maintenance status
    assert_success
    assert_output --partial "on"
    BUDMON_REEXEC=1 run "${SCRIPT}" maintenance off
    assert_success
    [ ! -e "${BUDMON_HOME}/maintenance/on" ] || { echo "${home}: flag kept"; return 1; }
  done
}

@test "TP-15.50: without state, printf v | secret set main/api/S3_ACCESS_KEY_ID exits 0" {
  local home
  for home in empty unfinished; do
    [ "${home}" = unfinished ] && unfinished_install
    run bash -c "printf 'v' | BUDMON_REEXEC=1 '${SCRIPT}' secret set main/api/S3_ACCESS_KEY_ID"
    assert_success
  done
}
