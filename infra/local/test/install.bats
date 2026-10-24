#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-178 `install` and `maintenance`. TP-15.22 (a) to (e), stub part.
#
# A-385: prompts `KEY [default]: ` on stderr in F-175's site.env table order (CAPTURE_KEY_VERSION
# isn't asked), answers read with `IFS= read -r` from stdin, end of input answering blank for the
# rest. A-386: only step 11 sets BUDMON_FIRST_SETUP=1, for `up -d postgres`. Assumed: `sudo` is a
# stub that records every call and performs `install`/`grep` without changing ownership; F-191 is
# reached as `pnpm … secrets init-local --home <home>`.

bats_require_minimum_version 1.5.0

load helpers

# One answer per prompt: PUBLIC_ORIGIN (Tailscale name), GOOGLE_OAUTH_CLIENT_ID (blank), S3_ENDPOINT,
# S3_REGION, S3_BUCKET_EXPORTS, S3_BUCKET_ERASURE_LOG (defaults), SENTRY_DSN, GOOGLE_SIGNIN_CLIENT_ID,
# GOOGLE_SIGNIN_ANDROID_CLIENT_IDS (blank), GOOGLE_SIGNIN_CALLBACK_ORIGIN, GOOGLE_SIGNIN_APP_ORIGINS,
# SMTP_URL, EMAIL_FROM (defaults). WEB_SENTRY_DSN, asked last (A-423), is left unanswered: end of
# input answers blank, so it's written __FILL_ME__.
ANSWERS=$'laptop.tailnet.ts.net\n\n\n\n\n\nhttps://k@o1.ingest.sentry.io/1\n123-abc.apps.googleusercontent.com\n\n\n\n\n\n'

setup() {
  common_setup
  cat >"${STUB_CONFIG}" <<'CONF'
stub_git() {
  local args=("$@") where=""
  while [ "${args[0]:-}" = "-C" ]; do where="${args[1]}"; args=("${args[@]:2}"); done
  case "${args[0]:-}" in
    rev-parse)
      # TP-15.39 (f): an existing build worktree at another commit.
      if [ "${STALE_WORKTREE:-0}" = 1 ] && [[ "${where}" == */build/v1.0.0 ]]; then
        echo "badbad0000000000000000000000000000000002"
      else
        echo "c0ffee0000000000000000000000000000000001"
      fi ;;
    rev-list) echo 42 ;;
    merge-base|fetch) return 0 ;;
    worktree)
      if [ "${args[1]}" = "add" ]; then
        local dir="" a
        for a in "${args[@]:2}"; do case "${a}" in --*) ;; *) [ -z "${dir}" ] && dir="${a}" ;; esac; done
        mkdir -p "${dir}/infra/local" "${dir}/apps/server"
        (cd "${ROOT_FOR_STUBS}/infra/local" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dir}/infra/local" && tar -xf -)
        # Phase B is recorded, not run: install's own steps are what this file tests.
        cat >"${dir}/infra/local/budmon-local" <<'REC'
#!/usr/bin/env bash
printf 'budmon-local\t%s\t%s\tREEXEC=%s\tpath=%s\tFIRST_SETUP=%s\n' "${PWD}" "$*" "${BUDMON_REEXEC:-}" "$0" "${BUDMON_FIRST_SETUP:-}" >>"${CALLS}"
exit "${PHASE_B_EXIT:-0}"
REC
        chmod +x "${dir}/infra/local/budmon-local"
      fi ;;
  esac
  return 0
}
stub_pnpm() {
  local all="$*" prev="" a home=""
  if [[ "${all}" == *"secrets init-local"* ]]; then
    for a in "$@"; do [ "${prev}" = "--home" ] && home="${a}"; prev="${a}"; done
    fake_init_local "${home}"
  fi
  return 0
}
stub_sudo() {
  case "$1" in
    --)
      # A-429: `sudo -- sh -c '<grep>; printf "status=%s\n" "$?"' …`, run for real, with an
      # optional grep stub ahead on PATH (GREP_EXIT), or sudo itself failing (SUDO_SH_FAIL).
      shift
      [ "${SUDO_SH_FAIL:-0}" = 1 ] && return 1
      if [ -n "${GREP_EXIT:-}" ]; then
        local d; d="$(mktemp -d)"
        printf '#!/bin/sh\nexit %s\n' "${GREP_EXIT}" >"${d}/grep"
        chmod +x "${d}/grep"
        PATH="${d}:${PATH}" "$@"
        return $?
      fi
      "$@"
      return $? ;;
    install)
      local args=("$@") out="${args[-1]}" i dir=0
      if [ -n "${INSTALL_FAIL_MATCH:-}" ] && [[ "${out}" == *"${INSTALL_FAIL_MATCH}" ]]; then return 1; fi
      for i in "${args[@]}"; do [ "${i}" = "-d" ] && dir=1; done
      if [ "${dir}" = 1 ]; then mkdir -p "${out}"; elif [[ " $* " == *" /dev/stdin "* ]]; then mkdir -p "$(dirname "${out}")"; cat >"${out}"; fi
      return 0 ;;
    grep) shift; grep "$@"; return $? ;;
    cat) shift; cat "$@"; return $? ;;
    *) return 0 ;;
  esac
}
stub_openssl() {
  local prev="" a n
  n=$(( $(cat "${CALLS}.openssl" 2>/dev/null || echo 0) + 1 ))
  echo "${n}" >"${CALLS}.openssl"
  [ -n "${OPENSSL_FAIL_AT:-}" ] && [ "${n}" -eq "${OPENSSL_FAIL_AT}" ] && return 1
  for a in "$@"; do
    case "${prev}" in -out|-keyout) mkdir -p "$(dirname "${a}")"; echo "pem" >"${a}" ;; esac
    prev="${a}"
  done
  echo "pem"
  return 0
}
stub_docker() {
  local all="$*"
  if [[ "${all}" == run\ * && -n "${PROBE_FAIL_DIR:-}" && "${all}" == *"${PROBE_FAIL_DIR}:"* ]]; then return 1; fi
  if [[ "${all}" == *"pg_isready"* ]]; then
    [ -n "${PG_PROBE_SLEEP:-}" ] && /bin/sleep "${PG_PROBE_SLEEP}"
    return "${PG_READY_EXIT:-0}"
  fi
  return 0
}
CONF
  export ROOT_FOR_STUBS="${ROOT}" ANSWERS
}

placeholder_ready_home() {
  # As after (a), with every placeholder filled and F-179's output in site.env.
  printf "%s" "${ANSWERS}" | "${SCRIPT}" install v1.0.0 >/dev/null 2>&1 || true
  fill_placeholders
  sed -i -e 's/^GOOGLE_OAUTH_CLIENT_ID=.*/GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com/' \
    -e 's|^CAPTURE_KEY_VERSION=.*|CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1|' \
    -e 's|^WEB_SENTRY_DSN=.*|WEB_SENTRY_DSN=https://pub@o1.ingest.sentry.io/2|' \
    "${BUDMON_HOME}/site.env"
  : >"${CALLS}"
}

@test "TP-15.22 (a): install on an empty home runs F-191, hands each service directory to its UID, writes site.env 0600 with two placeholders, and exits 20 naming paths and keys only" {
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20

  run bash -c "awk -F'\t' '\$1==\"pnpm\"' '${CALLS}'"
  assert_output --partial "secrets init-local --home ${BUDMON_HOME}"
  assert_output --partial "${BUDMON_HOME}/build/v1.0.0"

  # A-421, A-428: per service directory, chmod 0400 on its files (sudo find), then chmod 0500 on
  # it, then chown -R.
  local uid dir path files_at dir_at chown_at
  for pair in "10001 secrets/main/api" "10002 secrets/main/worker-general" "10003 secrets/capture/worker-capture" "10004 secrets/main/migrate" "999 secrets/main/postgres"; do
    read -r uid dir <<<"${pair}"
    path="${BUDMON_HOME}/${dir}"
    # A-428: the files' chmod goes through `sudo find`, which works once another UID owns the dir.
    files_at="$(awk -F'\t' -v a="find ${path} -maxdepth 1 -type f -exec chmod 0400 {} +" '$1=="sudo" && $3==a { print NR; exit }' "${CALLS}")"
    dir_at="$(awk -F'\t' -v a="chmod 0500 ${path}" '$1=="sudo" && $3==a { print NR; exit }' "${CALLS}")"
    chown_at="$(awk -F'\t' -v a="chown -R ${uid}:${uid} ${path}" '$1=="sudo" && $3==a { print NR; exit }' "${CALLS}")"
    [ -n "${files_at}" ] && [ -n "${dir_at}" ] && [ -n "${chown_at}" ] &&
      [ "${files_at}" -lt "${dir_at}" ] && [ "${dir_at}" -lt "${chown_at}" ] || {
      echo "${dir}: files ${files_at:-none}, dir ${dir_at:-none}, chown ${chown_at:-none}"
      calls_of sudo
      return 1
    }
  done

  [ "$(stat -c '%a' "${BUDMON_HOME}/site.env")" = "600" ]
  run cat "${BUDMON_HOME}/site.env"
  assert_line "GOOGLE_OAUTH_CLIENT_ID=__FILL_ME__"
  assert_line "CAPTURE_KEY_VERSION=__FILL_ME__"
  assert_line "PUBLIC_ORIGIN=https://laptop.tailnet.ts.net"
  assert_line "S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com"
  assert_line "SMTP_URL=smtp://mailpit:1025"
  assert_line "WEB_SENTRY_DSN=__FILL_ME__"

  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  assert_output --partial "WEB_SENTRY_DSN"
  assert_output --partial "main/api/S3_ACCESS_KEY_ID"
  assert_output --partial "capture/worker-capture/GCP_CREDENTIALS"
  assert_output --partial "GOOGLE_OAUTH_CLIENT_ID"
  assert_output --partial "CAPTURE_KEY_VERSION"
  refute_output --partial "generated-"
}

@test "TP-15.22 (b): install after every placeholder is filled creates the network, pg/ (999, 0700), writes install.inprogress before first setup, calls _upgrade-continue --no-dump --first, then writes state and prints the tailscale command" {
  placeholder_ready_home
  run "${SCRIPT}" install v1.0.0
  assert_success
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /^network create/' '${CALLS}'"
  assert_output --partial "--internal"
  assert_output --partial "--subnet 172.30.42.0/29"
  assert_output --partial "budmon_capture_db"
  run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^install -d/' '${CALLS}'"
  assert_output --regexp "-o 999 -g 999 -m 0700 .*${BUDMON_HOME}/pg"
  run bash -c "awk -F'\t' '\$1==\"budmon-local\"' '${CALLS}'"
  assert_output --partial "_upgrade-continue v1.0.0 --no-dump --first"
  refute [ -e "${BUDMON_HOME}/install.inprogress" ]
  run cat "${BUDMON_HOME}/state"
  assert_line "current=v1.0.0"
}

@test "TP-15.22 (b): a successful install prints the tailscale serve command for Windows" {
  placeholder_ready_home
  run "${SCRIPT}" install v1.0.0
  assert_success
  assert_output --partial "tailscale serve --bg --https=443 http://127.0.0.1:8080"
}

@test "TP-15.22 (b): install.inprogress (tag=v1.0.0, 0600) exists when Postgres starts with BUDMON_FIRST_SETUP=1" {
  placeholder_ready_home
  cat >>"${STUB_CONFIG}" <<'CONF'
stub_docker() {
  if [[ "$*" == *"BUDMON_FIRST_SETUP=1"* || "${BUDMON_FIRST_SETUP:-}" == 1 ]]; then
    if [ -f "${BUDMON_HOME}/install.inprogress" ]; then
      printf 'marker=%s mode=%s\n' "$(cat "${BUDMON_HOME}/install.inprogress")" "$(stat -c '%a' "${BUDMON_HOME}/install.inprogress")" >>"${CALLS}.marker"
    else
      echo "marker=missing" >>"${CALLS}.marker"
    fi
  fi
  return 0
}
CONF
  run "${SCRIPT}" install v1.0.0
  assert_success
  run cat "${CALLS}.marker"
  assert_output --partial "marker=tag=v1.0.0 mode=600"
  refute_output --partial "missing"
}

@test "TP-15.21 (A-386): BUDMON_FIRST_SETUP=1 reaches Compose only for step 11's up -d postgres, and never phase B" {
  placeholder_ready_home
  run "${SCRIPT}" install v1.0.0
  assert_success

  run bash -c "awk -F'\t' '\$NF==\"FIRST_SETUP=1\"' '${CALLS}'"
  [ "${#lines[@]}" -eq 1 ] || { echo "${output}"; return 1; }
  assert_line --regexp "^docker	.*compose .*up -d postgres	"
  run bash -c "awk -F'\t' '\$1==\"budmon-local\"' '${CALLS}'"
  assert_output --partial "_upgrade-continue v1.0.0"
  refute_output --partial "FIRST_SETUP=1"
}

@test "TP-15.22 (A-385): piped input with two answers then end of input: prompts in F-175's order on stderr, the rest default or __FILL_ME__" {
  run --separate-stderr bash -c "printf 'laptop.tailnet.ts.net\n123-oauth.apps.googleusercontent.com\n' | '${SCRIPT}' install v1.0.0"
  assert_failure 20

  local order
  order="$(grep -oE '[A-Z][A-Z0-9_]+( \[[^]]*\])?: ' <<<"${stderr}" | sed -E 's/( \[.*\])?: $//' | tr '\n' ' ')"
  [ "${order}" = "PUBLIC_ORIGIN GOOGLE_OAUTH_CLIENT_ID S3_ENDPOINT S3_REGION S3_BUCKET_EXPORTS S3_BUCKET_ERASURE_LOG SENTRY_DSN GOOGLE_SIGNIN_CLIENT_ID GOOGLE_SIGNIN_ANDROID_CLIENT_IDS GOOGLE_SIGNIN_CALLBACK_ORIGIN GOOGLE_SIGNIN_APP_ORIGINS SMTP_URL EMAIL_FROM WEB_SENTRY_DSN " ] || {
    echo "prompts: ${order}"
    return 1
  }
  [[ "${stderr}" == *"S3_ENDPOINT [https://s3.eu-central-003.backblazeb2.com]: "* ]] || { echo "${stderr}"; return 1; }
  [[ "${output}" != *"PUBLIC_ORIGIN"*": "* ]] || { echo "prompt on stdout: ${output}"; return 1; }

  run cat "${BUDMON_HOME}/site.env"
  assert_line "PUBLIC_ORIGIN=https://laptop.tailnet.ts.net"
  assert_line "GOOGLE_OAUTH_CLIENT_ID=123-oauth.apps.googleusercontent.com"
  assert_line "CAPTURE_KEY_VERSION=__FILL_ME__"
  assert_line "S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com"
  assert_line "S3_REGION=eu-central-003"
  assert_line "S3_BUCKET_EXPORTS=budmon-exports"
  assert_line "S3_BUCKET_ERASURE_LOG=budmon-erasure-log"
  assert_line "SENTRY_DSN=__FILL_ME__"
  assert_line "GOOGLE_SIGNIN_CLIENT_ID=__FILL_ME__"
  assert_line "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS="
  assert_line "GOOGLE_SIGNIN_CALLBACK_ORIGIN=http://localhost:8080"
  assert_line "GOOGLE_SIGNIN_APP_ORIGINS=https://laptop.tailnet.ts.net,http://localhost:8080"
  assert_line "SMTP_URL=smtp://mailpit:1025"
  assert_line "EMAIL_FROM=Budmon <no-reply@budmon.local>"
  # A-423: asked last with no default; blank is a placeholder.
  [[ "${stderr}" == *"EMAIL_FROM ["*"]: WEB_SENTRY_DSN []: "* ]] || { echo "${stderr}"; return 1; }
  assert_line "WEB_SENTRY_DSN=__FILL_ME__"
}

@test "TP-15.22 (c): install with state present exits 2" {
  write_state v1.0.0 ""
  run "${SCRIPT}" install v1.0.0
  assert_failure 2
}

@test "TP-15.22 (d): pg/ not empty without state or marker exits 2 (use restore)" {
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  run "${SCRIPT}" install v1.0.0
  assert_failure 2
  assert_output --partial "restore"
}

@test "TP-15.22 (d2): an initialised pg/ with install.inprogress tag=v1.0.0 resumes without first setup and calls _upgrade-continue --first" {
  placeholder_ready_home
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  printf 'tag=v1.0.0\n' >"${BUDMON_HOME}/install.inprogress"
  run "${SCRIPT}" install v1.0.0
  assert_success
  run grep -c "BUDMON_FIRST_SETUP" "${CALLS}"
  assert_output "0"
  run bash -c "awk -F'\t' '\$1==\"budmon-local\"' '${CALLS}'"
  assert_output --partial "_upgrade-continue v1.0.0 --no-dump --first"
}

@test "TP-15.22 (d3): resuming with another tag than the marker's exits 2" {
  mkdir -p "${BUDMON_HOME}/pg/pgdata"
  : >"${BUDMON_HOME}/pg/pgdata/PG_VERSION"
  printf 'tag=v1.0.0\n' >"${BUDMON_HOME}/install.inprogress"
  run "${SCRIPT}" install v1.0.1
  assert_failure 2
}

@test "TP-15.22 (e): a failing permission probe for main/api exits 21 naming secrets/main/api" {
  placeholder_ready_home
  export PROBE_FAIL_DIR="${BUDMON_HOME}/secrets/main/api"
  run "${SCRIPT}" install v1.0.0
  assert_failure 21
  assert_output --partial "secrets/main/api"
}

@test "TP-15.22 (e): maintenance on creates the flag, status reports on, off removes it" {
  write_state v1.0.0 ""
  make_release v1.0.0
  mkdir -p "${BUDMON_HOME}/maintenance"
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance on
  assert_success
  assert [ -f "${BUDMON_HOME}/maintenance/on" ]
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance status
  assert_success
  assert_output --partial "on"
  BUDMON_REEXEC=1 run "${BUDMON_HOME}/releases/v1.0.0/budmon-local" maintenance off
  assert_success
  refute [ -e "${BUDMON_HOME}/maintenance/on" ]
}

# ---- TP-15.39 (A-428): install is resumable step by step ----

# A recording mv that does the move (mv isn't one of the shared stubs).
recording_mv() {
  cat >"${STUB_DIR}/mv" <<'MV'
#!/usr/bin/env bash
printf 'mv\t%s\t%s\n' "${PWD}" "$*" >>"${CALLS}"
exec /bin/mv "$@"
MV
  chmod +x "${STUB_DIR}/mv"
}

@test "TP-15.39 (a), (b): openssl failing on its third call leaves no ca/ files and no .ca-tmp.*; a re-run completes, moving ca.crt then ca.key last" {
  recording_mv
  export OPENSSL_FAIL_AT=3
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 1
  [ -z "$(find "${BUDMON_HOME}/ca" -type f 2>/dev/null)" ] || { find "${BUDMON_HOME}/ca"; return 1; }
  [ -z "$(find "${BUDMON_HOME}" -maxdepth 1 -name '.ca-tmp.*')" ]

  unset OPENSSL_FAIL_AT
  rm -f "${CALLS}.openssl"
  : >"${CALLS}"
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  local key
  for key in main/postgres/TLS_KEY main/postgres/TLS_CERT capture/worker-capture/DB_CA_CERT; do
    run bash -c "awk -F'\t' '\$1==\"sudo\" && \$3 ~ /^install .*\/dev\/stdin .*secrets\/${key//\//\\/}$/' '${CALLS}'"
    [ -n "${output}" ] || { echo "no write of ${key}"; return 1; }
  done
  run bash -c "awk -F'\t' '\$1==\"mv\" && \$3 ~ /\/ca\.(crt|key) /' '${CALLS}'"
  [ "${#lines[@]}" -eq 2 ] || { echo "${output}"; return 1; }
  [[ "${lines[0]}" == *"/ca.crt "*"/ca/ca.crt" ]] && [[ "${lines[1]}" == *"/ca.key "*"/ca/ca.key" ]] || { echo "${output}"; return 1; }
  [ "$(stat -c '%a' "${BUDMON_HOME}/ca/ca.key")" = "400" ]
  [ "$(stat -c '%a' "${BUDMON_HOME}/ca/ca.crt")" = "444" ]
  [ "$(stat -c '%a' "${BUDMON_HOME}/ca")" = "700" ]
}

@test "TP-15.39 (c): a write_secret failing for TLS_CERT leaves no ca/ca.key; the re-run regenerates and writes all three" {
  export INSTALL_FAIL_MATCH="/TLS_CERT"
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure
  [ ! -e "${BUDMON_HOME}/ca/ca.key" ]

  unset INSTALL_FAIL_MATCH
  : >"${CALLS}"
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  [ -e "${BUDMON_HOME}/ca/ca.key" ]
  run bash -c "awk -F'\t' '\$1==\"openssl\"' '${CALLS}' | wc -l"
  [ "${output}" -ge 3 ]
  for key in TLS_KEY TLS_CERT DB_CA_CERT; do
    awk -F'\t' -v k="/${key}" '$1=="sudo" && $3 ~ /^install .*\/dev\/stdin / && substr($3, length($3) - length(k) + 1) == k { found = 1 } END { exit !found }' "${CALLS}" ||
      { echo "no write of ${key}"; return 1; }
  done
}

@test "TP-15.39 (d): stale .ca-tmp.x and .site.env.y in BUDMON_HOME are removed" {
  mkdir -p "${BUDMON_HOME}/.ca-tmp.x"
  : >"${BUDMON_HOME}/.site.env.y"
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  [ ! -e "${BUDMON_HOME}/.ca-tmp.x" ]
  [ ! -e "${BUDMON_HOME}/.site.env.y" ]
}

@test "TP-15.39 (e): a second install with secrets/.initialised and ca/ca.key: no openssl, no F-191, ownership applied again for every service directory" {
  placeholder_ready_home
  [ -e "${BUDMON_HOME}/secrets/.initialised" ] && [ -e "${BUDMON_HOME}/ca/ca.key" ]
  run "${SCRIPT}" install v1.0.0
  run calls_of openssl
  assert_output ""
  run bash -c "awk -F'\t' '\$1==\"pnpm\" && \$3 ~ /secrets init-local/' '${CALLS}'"
  assert_output ""
  local uid dir path
  for pair in "10001 secrets/main/api" "10002 secrets/main/worker-general" "10003 secrets/capture/worker-capture" "10004 secrets/main/migrate" "999 secrets/main/postgres"; do
    read -r uid dir <<<"${pair}"
    path="${BUDMON_HOME}/${dir}"
    grep -qF "find ${path} -maxdepth 1 -type f -exec chmod 0400 {} +" "${CALLS}" || { echo "no find for ${dir}"; return 1; }
    grep -qF "chmod 0500 ${path}" "${CALLS}" || { echo "no chmod for ${dir}"; return 1; }
    grep -qF "chown -R ${uid}:${uid} ${path}" "${CALLS}" || { echo "no chown for ${dir}"; return 1; }
  done
}

@test "TP-15.39 (f): build/v1.0.0 at another commit is removed (worktree remove --force) and added again" {
  mkdir -p "${BUDMON_HOME}/build/v1.0.0"
  export STALE_WORKTREE=1
  run bash -c "printf '%s' \"\${ANSWERS}\" | '${SCRIPT}' install v1.0.0"
  local removed added
  removed="$(awk -F'\t' '$1=="git" && $3 ~ /worktree remove --force .*build\/v1\.0\.0/ { print NR; exit }' "${CALLS}")"
  added="$(awk -F'\t' '$1=="git" && $3 ~ /worktree add .*build\/v1\.0\.0/ { print NR; exit }' "${CALLS}")"
  [ -n "${removed}" ] && [ -n "${added}" ] && [ "${removed}" -lt "${added}" ] || { calls_of git; return 1; }
}

# ---- TP-15.40 (A-429, A-430): the placeholder check fails closed ----

@test "TP-15.40 (a), (b): grep exiting 2, or sudo failing: exit 28 naming the cause; no permission probe and no network" {
  local mode
  for mode in grep sudo; do
    placeholder_ready_home
    if [ "${mode}" = grep ]; then export GREP_EXIT=2; unset SUDO_SH_FAIL; else unset GREP_EXIT; export SUDO_SH_FAIL=1; fi
    run "${SCRIPT}" install v1.0.0
    [ "${status}" -eq 28 ] || { echo "${mode}: exit ${status}: ${output}"; return 1; }
    if [ "${mode}" = grep ]; then
      assert_output --partial "placeholder check failed: can't search secrets/ (grep status 2)"
    else
      assert_output --partial "placeholder check failed: can't search secrets/ (sudo failed)"
    fi
    run bash -c "awk -F'\t' '\$1==\"docker\" && (\$3 ~ /^run / || \$3 ~ /network create/)' '${CALLS}'"
    assert_output ""
  done
}

@test "TP-15.40 (c): grep exiting 1 (no match): install proceeds past step 7" {
  placeholder_ready_home
  export GREP_EXIT=1
  run "${SCRIPT}" install v1.0.0
  [ "${status}" -ne 28 ] && [ "${status}" -ne 20 ] || { echo "exit ${status}: ${output}"; return 1; }
  run bash -c "awk -F'\t' '\$1==\"docker\" && \$3 ~ /network create/' '${CALLS}'"
  [ -n "${output}" ]
}

@test "TP-15.40 (d): an unreadable site.env: exit 28 (can't read site.env)" {
  [ "$(id -u)" -ne 0 ] || skip "A-369: root reads a 0000 file; runs on CI's non-root runner"
  placeholder_ready_home
  chmod 0000 "${BUDMON_HOME}/site.env"
  run "${SCRIPT}" install v1.0.0
  assert_failure 28
  assert_output --partial "placeholder check failed: can't read site.env"
}

@test "TP-15.40 (e): GOOGLE_SIGNIN_APP_ORIGINS containing __FILL_ME__ is listed (exit 20)" {
  placeholder_ready_home
  sed -i 's|^GOOGLE_SIGNIN_APP_ORIGINS=.*|GOOGLE_SIGNIN_APP_ORIGINS=__FILL_ME__,http://localhost:8080|' "${BUDMON_HOME}/site.env"
  run "${SCRIPT}" install v1.0.0
  assert_failure 20
  assert_output --partial "site.env GOOGLE_SIGNIN_APP_ORIGINS"
}

@test "TP-15.40 (f): a blank PUBLIC_ORIGIN leaves GOOGLE_SIGNIN_APP_ORIGINS without a default; blank writes __FILL_ME__, listed (exit 20)" {
  run --separate-stderr bash -c "printf '\n' | '${SCRIPT}' install v1.0.0"
  assert_failure 20
  [[ "${stderr}" == *"GOOGLE_SIGNIN_APP_ORIGINS []: "* ]] || { echo "${stderr}"; return 1; }
  run cat "${BUDMON_HOME}/site.env"
  assert_line "GOOGLE_SIGNIN_APP_ORIGINS=__FILL_ME__"
  run bash -c "printf '\n' | '${SCRIPT}' install v1.0.0 2>&1"
  assert_output --partial "GOOGLE_SIGNIN_APP_ORIGINS"
}

# ---- TP-15.40 (A-488): the DSN prompts use F-10's production pattern ----

@test "TP-15.40 (g) (A-488): invalid SENTRY_DSN and WEB_SENTRY_DSN answers are asked again, never echoed; the valid one is written, end of input gives __FILL_ME__" {
  # Prompt order (F-175): six blanks up to SENTRY_DSN, then six blanks up to WEB_SENTRY_DSN.
  local answers
  answers="$(printf '\n\n\n\n\n\n%s\n%s\n\n\n\n\n\n\n%s\n%s\n' \
    'https://sentry.io/1' 'https://0123abcd@o1.ingest.sentry.io/42' \
    'https://k@o1.ingest.sentry.io/x' 'http://k@localhost:9000/1')"
  run --separate-stderr bash -c "printf '%s' '${answers}' | '${SCRIPT}' install v1.0.0"
  [ "$(grep -c 'invalid value for SENTRY_DSN' <<<"${stderr}")" -eq 1 ] || { echo "${stderr}"; return 1; }
  [ "$(grep -c 'invalid value for WEB_SENTRY_DSN' <<<"${stderr}")" -eq 2 ] || { echo "${stderr}"; return 1; }
  local rejected
  for rejected in 'https://sentry.io/1' 'https://k@o1.ingest.sentry.io/x' 'http://k@localhost:9000/1'; do
    [[ "${output}${stderr}" != *"${rejected}"* ]] || { echo "echoed: ${rejected}"; return 1; }
  done
  run cat "${BUDMON_HOME}/site.env"
  assert_line "SENTRY_DSN=https://0123abcd@o1.ingest.sentry.io/42"
  assert_line "WEB_SENTRY_DSN=__FILL_ME__"
}

@test "TP-15.40 (h) (A-488): site_valid accepts a DSN with a port and rejects a password or an extra path segment, for both keys" {
  local key
  for key in SENTRY_DSN WEB_SENTRY_DSN; do
    run bash -c "source '${LOCAL}/lib/secrets.sh'; site_valid ${key} 'https://0123abcd@o1.ingest.sentry.io:8443/7'"
    [ "${status}" -eq 0 ] || { echo "${key}: port rejected"; return 1; }
    run bash -c "source '${LOCAL}/lib/secrets.sh'; site_valid ${key} 'https://pub:SECRET@o1.ingest.sentry.io/1'"
    [ "${status}" -eq 1 ] || { echo "${key}: password accepted (${status})"; return 1; }
    run bash -c "source '${LOCAL}/lib/secrets.sh'; site_valid ${key} 'https://k@h/1/2'"
    [ "${status}" -eq 1 ] || { echo "${key}: two segments accepted (${status})"; return 1; }
  done
}

# ---- TP-15.43 (A-433): install step 11's Postgres wait is bounded ----

@test "TP-15.43: install step 11 with a pg_isready taking 3 s and failing, BUDMON_PG_READY_TIMEOUT=2: at most 2 probes, within 6 s" {
  placeholder_ready_home
  export PG_PROBE_SLEEP=3 PG_READY_EXIT=1 BUDMON_PG_READY_TIMEOUT=2
  local started=${SECONDS}
  run "${SCRIPT}" install v1.0.0
  assert_failure
  local probes
  probes="$(awk -F'\t' '$1=="docker" && $3 ~ /pg_isready/' "${CALLS}" | wc -l)"
  [ "${probes}" -ge 1 ] && [ "${probes}" -le 2 ] || { echo "${probes} probes"; return 1; }
  [ $((SECONDS - started)) -le 7 ] || { echo "took $((SECONDS - started)) s"; return 1; }
}

