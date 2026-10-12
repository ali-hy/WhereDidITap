#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `upgrade` phase A: tag checks, ancestry, the release copy and the re-exec into phase B.
# TP-15.20.

load helpers

COMMIT="c0ffee0000000000000000000000000000000001"

setup() {
  common_setup
  write_state v1.1.0 ""
  make_release v1.1.0
  # git: fetch ok; rev-parse prints COMMIT; ancestry per $ANCESTOR_OF (space-separated refs that
  # contain the tag); worktree add creates a tree whose infra/local holds a recording budmon-local.
  cat >"${STUB_CONFIG}" <<CONF
stub_git() {
  local args=("\$@")
  while [ "\${args[0]:-}" = "-C" ]; do args=("\${args[@]:2}"); done
  case "\${args[0]:-}" in
    fetch) return 0 ;;
    rev-parse|rev-list) echo "${COMMIT}"; return 0 ;;
    remote) return 0 ;;
    symbolic-ref) echo "origin/master"; return 0 ;;
    merge-base)
      # A-408: the default branch is origin's HEAD (master here), by either name.
      local ref="\${args[-1]}"
      for ok in \${ANCESTOR_OF:-origin/HEAD origin/master}; do [ "\${ref}" = "\${ok}" ] && return 0; done
      return 1 ;;
    worktree)
      if [ "\${args[1]}" = "add" ]; then
        local dir="" a
        for a in "\${args[@]:2}"; do case "\${a}" in --*) ;; *) [ -z "\${dir}" ] && dir="\${a}" ;; esac; done
        mkdir -p "\${dir}/infra/local/lib" "\${dir}/infra/local/test" "\${dir}/infra/local/rehearsal"
        echo "env" >"\${dir}/infra/local/local.env"
        echo "lib" >"\${dir}/infra/local/lib/common.sh"
        echo "t" >"\${dir}/infra/local/test/x.bats"
        echo "r" >"\${dir}/infra/local/rehearsal/compose.rehearsal.yaml"
        cat >"\${dir}/infra/local/budmon-local" <<'REC'
#!/usr/bin/env bash
printf 'budmon-local\t%s\t%s\tREEXEC=%s\tpath=%s\n' "\${PWD}" "\$*" "\${BUDMON_REEXEC:-}" "\$0" >>"\${CALLS}"
exit 0
REC
        chmod +x "\${dir}/infra/local/budmon-local"
      fi
      return 0 ;;
  esac
  return 0
}
CONF
}

@test "TP-15.20: upgrade v1.2 exits 10 (tag format)" {
  run "${SCRIPT}" upgrade v1.2
  assert_failure 10
}

@test "TP-15.20: upgrade 'v1.2.0;rm' exits 10" {
  run "${SCRIPT}" upgrade 'v1.2.0;rm'
  assert_failure 10
  refute [ -e "${BUDMON_HOME}/releases/v1.2.0;rm" ]
}

@test "TP-15.20: upgrade v1.2.0-infra.1 exits 10 (no infra tags in stage 0)" {
  run "${SCRIPT}" upgrade v1.2.0-infra.1
  assert_failure 10
}

@test "TP-15.20: upgrade v1.2.0 where the ancestry check fails exits 11" {
  export ANCESTOR_OF="origin/nothing"
  run "${SCRIPT}" upgrade v1.2.0
  assert_failure 11
  refute [ -d "${BUDMON_HOME}/releases/v1.2.0" ]
}

@test "TP-15.20: a hotfix tag contained only in origin/hotfix/<tag> proceeds" {
  export ANCESTOR_OF="origin/hotfix/v1.2.0-hotfix.1"
  run "${SCRIPT}" upgrade v1.2.0-hotfix.1
  assert_success
  assert [ -f "${BUDMON_HOME}/releases/v1.2.0-hotfix.1/RELEASE" ]
}

@test "TP-15.20: an existing releases/v1.2.0/RELEASE naming another commit exits 12" {
  make_release v1.2.0 "deadbeef00000000000000000000000000000000"
  run "${SCRIPT}" upgrade v1.2.0
  assert_failure 12
  run cat "${BUDMON_HOME}/releases/v1.2.0/RELEASE"
  assert_output --partial "commit=deadbeef00000000000000000000000000000000"
}

@test "TP-15.20: upgrade v1.2.0 copies infra/local without test/ and rehearsal/, writes RELEASE, and execs the copy's _upgrade-continue with BUDMON_REEXEC=1" {
  run "${SCRIPT}" upgrade v1.2.0
  assert_success
  local rel="${BUDMON_HOME}/releases/v1.2.0"
  assert [ -x "${rel}/budmon-local" ]
  assert [ -f "${rel}/local.env" ]
  assert [ -f "${rel}/lib/common.sh" ]
  refute [ -e "${rel}/test" ]
  refute [ -e "${rel}/rehearsal" ]
  run cat "${rel}/RELEASE"
  assert_line "tag=v1.2.0"
  assert_line "commit=${COMMIT}"
  run tail -n 1 "${CALLS}"
  assert_output --regexp "^budmon-local	.*	_upgrade-continue v1.2.0	REEXEC=1	path=${rel}/budmon-local$"
}

@test "TP-15.20 (A-408): the ancestry check refreshes origin's HEAD and never names a branch" {
  run "${SCRIPT}" upgrade v1.2.0
  assert_success
  run bash -c "awk -F'\t' '\$1==\"git\" { print \$3 }' '${CALLS}'"
  assert_output --partial "remote set-head origin --auto"
  refute_output --partial "origin/main"
  assert_output --regexp "merge-base --is-ancestor v1\.2\.0 origin/(HEAD|master)"
}

@test "TP-15.20: upgrade --no-dump is passed on to phase B" {
  run "${SCRIPT}" upgrade v1.2.0 --no-dump
  assert_success
  run tail -n 1 "${CALLS}"
  assert_output --partial "_upgrade-continue v1.2.0 --no-dump"
}

@test "TP-15.20: an unknown command exits 64 with the usage text" {
  run "${SCRIPT}" frobnicate
  assert_failure 64
  assert_output --partial "usage"
}
