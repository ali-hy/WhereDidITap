#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `bootstrap-owner` (A-6). TP-15.29.
#
# docker is a stub: `compose … ps` (any form) reports api running unless API_DOWN=1; `exec … api …
# identity:bootstrap-owner` prints a link and exits OWNER_EXIT (default 0).

load helpers

LINK="https://l.t.ts.net/welcome#t=abc123"

setup() {
  common_setup
  write_state v1.0.0 ""
  make_release v1.0.0
  cat >"${STUB_CONFIG}" <<CONF
stub_docker() {
  local all="\$*"
  if [[ "\${all}" == *" ps"* || "\${all}" == *"inspect"* ]]; then
    if [ "\${API_DOWN:-0}" = 1 ]; then return 1; fi
    echo "api running"
    return 0
  fi
  if [[ "\${all}" == *"identity:bootstrap-owner"* ]]; then
    echo "${LINK}"
    return "\${OWNER_EXIT:-0}"
  fi
  return 0
}
CONF
}

owner() {
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" bootstrap-owner "$@"
}

owner_calls() { awk -F'\t' '$1=="docker" && $3 ~ /identity:bootstrap-owner/' "${CALLS}"; }

@test "TP-15.29 (a): exactly one compose exec -T api node dist/main/cli.js identity:bootstrap-owner --email o@example.com; the link passed through; exit 0" {
  owner --email o@example.com
  assert_success
  assert_output --partial "${LINK}"
  run owner_calls
  [ "$(printf '%s\n' "${output}" | grep -c .)" -eq 1 ]
  assert_output --regexp "compose .* exec -T api node dist/main/cli\.js identity:bootstrap-owner --email o@example\.com	"
  refute_output --partial " run "
}

@test "TP-15.29 (a): --replace is passed on" {
  owner --email o@example.com --replace
  assert_success
  run owner_calls
  assert_output --partial "identity:bootstrap-owner --email o@example.com --replace"
}

@test "TP-15.29 (b): the command exiting 1 exits 1" {
  export OWNER_EXIT=1
  owner --email o@example.com
  assert_failure 1
}

@test "TP-15.29 (c): api not running exits 25 with no exec" {
  export API_DOWN=1
  owner --email o@example.com
  assert_failure 25
  run owner_calls
  assert_output ""
}

@test "TP-15.29 (d): no --email exits 64" {
  owner
  assert_failure 64
  run owner_calls
  assert_output ""
}

@test "TP-15.29: compose run is never used" {
  owner --email o@example.com
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ / compose / && \$3 ~ / run /' '${CALLS}'"
  assert_output ""
}
