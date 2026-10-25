# shellcheck shell=bash
# budmon-local (F-178): starting, checking and switching the stack; phase B and restore.

# A-507 (1), A-508 (4): the services of budmon-<project> whose container didn't start, one per
# line: those `created` (never ran), then those `exited` with a non-empty State.Error (a start
# that failed after the container had run before). A normal stop or a crash leaves State.Error
# empty, so those containers are never listed. A failing `ps` counts as none; inspect's exit
# status is ignored. Blank lines (an empty list, or inspect's line for a container without a
# start error) are dropped: a blank name would make `rm -f ""` fail with `no such service:`.
unstarted_services() {
  local tag="$1" project="$2" created ids
  created="$(compose_for "${tag}" "${project}" ps -a --status created --services 2>/dev/null \
    </dev/null)" || created=""
  ids="$(compose_for "${tag}" "${project}" ps -a --status exited -q 2>/dev/null </dev/null)" || ids=""
  {
    printf '%s\n' "${created}"
    if [ -n "${ids}" ]; then
      local id_list=()
      mapfile -t id_list <<<"${ids}"
      docker container inspect \
        --format '{{if .State.Error}}{{index .Config.Labels "com.docker.compose.service"}}{{end}}' \
        "${id_list[@]}" 2>/dev/null </dev/null || true
    fi
  } | grep -v '^[[:space:]]*$' || true
}

# A-502 (2), A-507 (1): one project's `up -d`, after removing its containers that didn't start
# (for example on a taken port), so a re-run recreates them. No `-v`: bind mounts and volumes stay.
# Returns the first non-zero status of the `rm` and the `up -d`; Compose's own stderr reaches the
# terminal unchanged.
up_project() {
  local tag="$1" project="$2" unstarted status=0 code=0
  unstarted="$(unstarted_services "${tag}" "${project}")"
  if [ -n "${unstarted}" ]; then
    local services=()
    mapfile -t services <<<"${unstarted}"
    compose_for "${tag}" "${project}" rm -f "${services[@]}" </dev/null || status=$?
  fi
  compose_for "${tag}" "${project}" up -d </dev/null || code=$?
  [ "${status}" != 0 ] || status="${code}"
  return "${status}"
}

# A-502 (2): main, then (only if it started) capture. On a failure UP_PROJECT and UP_STATUS name
# the project and its exit status, and it returns 1.
up_both() {
  local tag="$1" status=0
  UP_PROJECT=""
  UP_STATUS=""
  up_project "${tag}" main || status=$?
  if [ "${status}" != 0 ]; then
    UP_PROJECT=budmon-main
    UP_STATUS="${status}"
    return 1
  fi
  up_project "${tag}" capture || status=$?
  if [ "${status}" != 0 ]; then
    UP_PROJECT=budmon-capture
    UP_STATUS="${status}"
    return 1
  fi
  return 0
}

# api, worker-general and worker-capture only: postgres, caddy and mailpit keep running. A failing
# stop isn't fatal (the connection block and terminations cover a service still running).
stop_app() {
  local tag="$1"
  compose_for "${tag}" main stop api worker-general </dev/null || true
  compose_for "${tag}" capture stop worker-capture </dev/null || true
}

# One readiness probe (A-502 (2)), checked in this order and stopping at the first failure, which
# it names in READY_FAILED: the API's readiness (directly, not through Caddy, which answers 503 in
# maintenance), both workers' heartbeats, the five main services running, and Caddy's and
# Mailpit's published ports.
ready_probe() {
  local tag="$1" running service
  if ! compose_for "${tag}" main exec -T api node dist/main/healthcheck.js --ready \
    >/dev/null 2>&1 </dev/null; then
    READY_FAILED="api not ready"
    return 1
  fi
  if ! compose_for "${tag}" main exec -T worker-general node dist/main/healthcheck.js \
    --heartbeat >/dev/null 2>&1 </dev/null; then
    READY_FAILED="worker-general heartbeat"
    return 1
  fi
  if ! compose_for "${tag}" capture exec -T worker-capture node dist/main/healthcheck.js \
    --heartbeat >/dev/null 2>&1 </dev/null; then
    READY_FAILED="worker-capture heartbeat"
    return 1
  fi
  running="$(compose_for "${tag}" main ps --status running --services 2>/dev/null </dev/null)" ||
    running=""
  for service in caddy api worker-general postgres mailpit; do
    if ! grep -qx -- "${service}" <<<"${running}"; then
      READY_FAILED="${service} not running"
      return 1
    fi
  done
  if [ "$(compose_for "${tag}" main port caddy 8080 2>/dev/null </dev/null)" != "127.0.0.1:8080" ]; then
    READY_FAILED="caddy not published on 127.0.0.1:8080"
    return 1
  fi
  if [ "$(compose_for "${tag}" main port mailpit 8025 2>/dev/null </dev/null)" != "127.0.0.1:8025" ]; then
    READY_FAILED="mailpit not published on 127.0.0.1:8025"
    return 1
  fi
  READY_FAILED=""
  return 0
}

# Readiness within BUDMON_READY_TIMEOUT seconds (A-433: a SECONDS deadline, probed at least once).
# On a timeout READY_FAILED holds the last probe's failing check.
wait_ready() {
  local tag="$1" deadline=$((SECONDS + READY_TIMEOUT))
  READY_FAILED=""
  while :; do
    ready_probe "${tag}" && return 0
    [ "${SECONDS}" -lt "${deadline}" ] || return 1
    sleep 1
  done
}

maintenance_on() {
  mkdir -p "${BUDMON_HOME}/maintenance"
  : >"${BUDMON_HOME}/maintenance/on"
  chmod 0644 "${BUDMON_HOME}/maintenance/on"
}

maintenance_off() {
  rm -f "${BUDMON_HOME}/maintenance/on"
}

# `migrate` of release <tag> (its files and image); extra arguments go to `compose run`.
# Prints its output; returns its exit code.
run_migrate() {
  local tag="$1"
  shift
  compose_for "${tag}" main --profile tools run --rm "$@" migrate </dev/null 2>&1
}

# Phase B step 8 (A-426): drops nothing while restore.inprogress exists or while budmon can't be
# confirmed to exist; the upgrade still succeeds.
drop_leftover_databases() {
  local tag="$1" db count
  if [ -e "$(restore_marker)" ]; then
    echo "budmon-local: leftover databases kept: a restore didn't finish (restore.inprogress)" >&2
    return 0
  fi
  count="$(admin_sql "${tag}" "SELECT count(*) FROM pg_database WHERE datname = 'budmon'" \
    2>/dev/null)" || count=""
  if [ "${count}" != 1 ]; then
    echo "budmon-local: leftover databases kept: can't confirm budmon exists" >&2
    return 0
  fi
  while IFS= read -r db; do
    [[ "${db}" =~ ^budmon_(old|restore_failed)_[0-9]{8}T[0-9]{6}Z$ ]] || continue
    admin_sql "${tag}" "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)" >/dev/null || true
  done < <(admin_sql "${tag}" \
    "SELECT datname FROM pg_database WHERE datname ~ '^budmon_(old|restore_failed)_'" 2>/dev/null || true)
}

# ---- phase B (`_upgrade-continue <tag> [--no-dump] [--first]`) ----

cmd_upgrade_continue() {
  local tag="${1:-}" no_dump=0 first=0 arg
  [ -n "${tag}" ] || usage
  shift
  for arg in "$@"; do
    case "${arg}" in
      --no-dump) no_dump=1 ;;
      --first) first=1 ;;
      *) usage ;;
    esac
  done
  # 0. A-502 (4): an upgrade needs an installation; install's own call passes --first.
  if [ "${first}" = 0 ] && [ ! -f "${BUDMON_HOME}/state" ]; then
    die 2 "not installed: run budmon-local install <tag>"
  fi
  check_tag_format "${tag}"
  local current previous
  current="$(state_get current)"
  previous="$(state_get previous)"

  # 1. Images.
  build_images "${tag}"

  # 2. The pre-upgrade dump of the running release's database.
  if [ "${no_dump}" = 0 ] && [ -n "${current}" ]; then
    mkdir -p "${BUDMON_HOME}/dumps"
    local dump
    dump="${BUDMON_HOME}/dumps/$(utc_stamp)_${current}.dump"
    (umask 077 && compose_for "${tag}" main exec -T -u postgres postgres \
      pg_dump -Fc -U budmon_admin budmon </dev/null >"${dump}") || {
      rm -f "${dump}"
      die 1 "the pre-upgrade dump failed"
    }
    chmod 0600 "${dump}"
    prune_dumps
  fi

  # 3. A queue upgrade stops the workers behind the maintenance flag.
  local maint=0
  if [ "${QUEUE_UPGRADE}" = 1 ]; then
    maintenance_on
    maint=1
    compose_for "${tag}" main stop worker-general </dev/null || true
    compose_for "${tag}" capture stop worker-capture </dev/null || true
  fi

  # 4. Migrate with the new release.
  local out
  if ! out="$(run_migrate "${tag}")"; then
    # A-435: migrate's structured, redacted log lines, then the reason.
    printf '%s\n' "${out}" >&2
    die 15 "migrate failed for ${tag}"
  fi

  # 5. Start both projects (A-502 (2)); a failed `up -d` skips the readiness wait.
  if ! up_both "${tag}"; then
    local failed_project="${UP_PROJECT}" failed_status="${UP_STATUS}"
    if [ "${first}" = 1 ] || [ -z "${current}" ]; then
      die 31 "starting ${tag} failed: docker compose up -d for ${failed_project} exited ${failed_status} (Compose's message is above); fix the cause, then run the same command again"
    fi
    # 7. Roll back to the running release.
    if up_both "${current}"; then
      die 31 "starting ${tag} failed: docker compose up -d for ${failed_project} exited ${failed_status}; ${current} started again"
    fi
    die 17 "starting ${tag} failed and starting ${current} again failed: run budmon-local start"
  fi
  # 6. Wait for readiness.
  if ! wait_ready "${tag}"; then
    # 7. Roll back to the running release.
    if [ "${first}" = 1 ] || [ -z "${current}" ]; then
      die 16 "${tag} isn't ready (${READY_FAILED}); containers left for budmon-local logs"
    fi
    if up_both "${current}"; then
      die 16 "${tag} isn't ready (${READY_FAILED}); ${current} started again"
    fi
    die 17 "${tag} isn't ready (${READY_FAILED}) and starting ${current} again failed"
  fi

  # 8. Record the release.
  [ "${maint}" = 1 ] && maintenance_off
  if [ "${current}" = "${tag}" ]; then
    state_write "${tag}" "${previous}"
  else
    state_write "${tag}" "${current}"
    previous="${current}"
  fi
  link_bin "${tag}"
  prune_releases "${tag}" "${previous}"
  drop_leftover_databases "${tag}"

  # 9. A rotated migrator password took effect through the fallback.
  if [[ "${out}" == *migrator_previous_password_used* ]]; then
    say "notice: migrator_previous_password_used: migrate logged in with DB_PASSWORD_PREVIOUS;" \
      "the new migrator password is now in effect"
  fi
  say "${tag} is running"
}

# ---- restore ----

# Free bytes on the filesystem holding <dir> (A-388: df -Pk field 4 × 1024).
free_bytes() {
  df -Pk -- "$1" | awk 'NR == 2 { print $4 * 1024 }'
}

mb_up() {
  echo $((($1 + 1048575) / 1048576))
}

# rename_db <tag> <from> <to>: with connections blocked, terminate sessions and rename, retried up
# to 3 times RENAME_RETRY_DELAY seconds apart. Returns 1 when every attempt failed.
rename_db() {
  local tag="$1" from="$2" to="$3" attempt
  for attempt in 1 2 3; do
    admin_sql "${tag}" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${from}' AND pid <> pg_backend_pid()" >/dev/null 2>&1 || true
    if admin_sql "${tag}" "ALTER DATABASE \"${from}\" RENAME TO \"${to}\"" >/dev/null 2>&1; then
      return 0
    fi
    [ "${attempt}" -lt 3 ] && sleep "${RENAME_RETRY_DELAY}"
  done
  return 1
}

# restore.inprogress (A-426): tag, from, old, failed; mode 0600, written atomically.
write_restore_marker() {
  local tmp
  tmp="$(mktemp "${BUDMON_HOME}/.restore.XXXXXX")"
  printf 'tag=%s\nfrom=%s\nold=%s\nfailed=%s\n' "$1" "$2" "$3" "$4" >"${tmp}"
  chmod 0600 "${tmp}"
  mv -f "${tmp}" "$(restore_marker)"
}

cmd_restore() {
  # 0. A-426: never over an unfinished restore.
  refuse_unfinished_restore
  [ "$#" -eq 1 ] || usage
  local file="$1" name tag
  name="$(basename -- "${file}")"
  [[ "${name}" =~ ^[0-9]{8}T[0-9]{6}Z_(v[^_]+)(_pre-restore)?\.dump$ ]] ||
    die 12 "not a budmon-local dump name: ${name}"
  tag="${BASH_REMATCH[1]}"
  [[ "${tag}" =~ ${TAG_PATTERN} ]] || die 12 "not a release tag in ${name}: ${tag}"
  [ -f "${file}" ] || die 12 "no such file: ${file}"
  local current previous
  current="$(state_get current)"
  previous="$(state_get previous)"
  [ -n "${current}" ] || die 2 "no state: install first"

  # 2. The file must be a dump with the platform's tables.
  local listing
  listing="$(compose_for "${current}" main exec -T -u postgres postgres pg_restore --list \
    <"${file}" 2>/dev/null)" || die 14 "dump invalid: pg_restore --list failed"
  [[ "${listing}" == *" TABLE public "* && "${listing}" == *" TABLE pgboss "* ]] ||
    die 14 "dump invalid: no public and pgboss tables"

  # 3. The release that wrote it.
  if [ ! -d "$(release_dir "${tag}")" ] || ! images_present "${tag}"; then
    local local_commit release_commit
    local_commit="$(git -C "${BUDMON_REPO}" rev-parse -q --verify "refs/tags/${tag}^{commit}" 2>/dev/null || true)"
    release_commit="$(sed -n 's/^commit=//p' "$(release_dir "${tag}")/RELEASE" 2>/dev/null || true)"
    if [ -z "${local_commit}" ] || [ "${local_commit}" != "${release_commit}" ]; then
      check_tag_ancestry "${tag}"
    fi
    make_worktree "${tag}"
    copy_release "${tag}"
    build_images "${tag}"
  fi

  # 4. Postgres up; the safety dump of the current database.
  wait_postgres "${current}" || die 18 "Postgres not running"
  local stamp safety
  stamp="$(utc_stamp)"
  safety="${BUDMON_HOME}/dumps/${stamp}_${current}_pre-restore.dump"
  mkdir -p "${BUDMON_HOME}/dumps"
  if ! (umask 077 && compose_for "${current}" main exec -T -u postgres postgres \
    pg_dump -Fc -U budmon_admin budmon </dev/null >"${safety}"); then
    rm -f "${safety}"
    die 19 "the safety dump failed; nothing was changed"
  fi
  chmod 0600 "${safety}"
  RESTORE_SAFETY="${safety}"

  # 4b. Free space: 3 × the dump + the current database.
  local dump_size db_size need have have_dumps
  dump_size="$(stat -c %s -- "${file}")"
  # A-388: psql -Atc as budmon_admin in the Postgres container.
  db_size="$(compose_for "${current}" main exec -T -u postgres postgres \
    psql -X -U budmon_admin -d postgres -Atc "SELECT pg_database_size('budmon')" </dev/null |
    tr -d '[:space:]')" || db_size=""
  # A-420: an unreadable size never counts as 0, which would under-estimate the space needed.
  [[ "${db_size}" =~ ^[0-9]+$ ]] || die 23 "disk space check failed: can't read the database size"
  need=$((3 * dump_size + db_size))
  have="$(free_bytes "${BUDMON_HOME}/pg")"
  if [ "$(stat -c %d -- "${BUDMON_HOME}/dumps")" != "$(stat -c %d -- "${BUDMON_HOME}/pg")" ]; then
    have_dumps="$(free_bytes "${BUDMON_HOME}/dumps")"
    [ "${have_dumps}" -lt "${have}" ] && have="${have_dumps}"
  fi
  if [ "${have}" -lt "${need}" ]; then
    die 23 "not enough disk space: need $(mb_up "${need}") MB, have $(mb_up "${have}") MB"
  fi

  # 5. budmon_restore from the file, with F-14's database-level statements re-applied.
  restore_fail() {
    echo "budmon-local: safety dump: ${RESTORE_SAFETY}" >&2
    die "$1" "$2"
  }
  admin_sql "${current}" "DROP DATABASE IF EXISTS \"budmon_restore\" WITH (FORCE)" >/dev/null ||
    restore_fail 29 "dropping budmon_restore failed"
  admin_sql "${current}" "CREATE DATABASE \"budmon_restore\" OWNER \"budmon_migrator\"" >/dev/null ||
    restore_fail 29 "creating budmon_restore failed"
  compose_for "${current}" main exec -T -u postgres postgres \
    pg_restore --exit-on-error -U budmon_admin -d budmon_restore <"${file}" >/dev/null ||
    restore_fail 29 "pg_restore into budmon_restore failed"
  # shellcheck disable=SC2016 # expanded inside the container
  compose_for "${current}" main exec -T -u postgres postgres sh -c \
    'BUDMON_MIGRATOR_PASSWORD="$(cat /run/secrets/MIGRATOR_VERIFIER)" psql -v ON_ERROR_STOP=1 -X -U budmon_admin -d postgres -v dbname=budmon_restore -f /docker-entrypoint-initdb.d/10-budmon.sql.tpl' \
    </dev/null >/dev/null || restore_fail 29 "re-applying the cluster bootstrap failed"

  # 6. The dump's release migrates and verifies it, as the migrate service.
  local migrate_out
  if ! migrate_out="$(run_migrate "${tag}" -e DB_NAME=budmon_restore)"; then
    printf '%s\n' "${migrate_out}" >&2 # A-435
    restore_fail 15 "migrate of budmon_restore failed"
  fi
  compose_for "${tag}" main --profile tools run --rm -e DB_NAME=budmon_restore migrate \
    node dist/main/cli.js restore:verify </dev/null ||
    restore_fail 6 "restore:verify failed for budmon_restore"

  # 7. The switch. From the marker on, a failure names where the data is (A-426).
  maintenance_on
  stop_app "${current}"
  local old="budmon_old_${stamp}" failed="budmon_restore_failed_${stamp}"
  local incomplete="restore rollback incomplete:"
  local runbook="maintenance stays on; see the runbook (A restore didn't finish)"
  write_restore_marker "${tag}" "${current}" "${old}" "${failed}"
  admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS false" >/dev/null || true
  if ! rename_db "${current}" budmon "${old}"; then
    admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS true" >/dev/null ||
      restore_fail 26 "${incomplete} budmon holds the data from before the restore but refuses connections; ${runbook}"
    rm -f "$(restore_marker)"
    restore_fail 24 "budmon is still in use; nothing was renamed"
  fi
  if ! rename_db "${current}" budmon_restore budmon; then
    rename_db "${current}" "${old}" budmon ||
      restore_fail 26 "${incomplete} budmon is missing; the data from before the restore is in ${old} and the restored copy in budmon_restore; ${runbook}"
    admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS true" >/dev/null ||
      restore_fail 26 "${incomplete} budmon holds the data from before the restore but refuses connections; ${runbook}"
    rm -f "$(restore_marker)"
    restore_fail 24 "budmon_restore is still in use; the names are restored"
  fi
  # Not fatal by itself: the readiness wait then fails and the rollback runs.
  admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS true" >/dev/null || true

  # 8. Start the dump's release (A-502 (2)); a failed `up -d` skips the wait and rolls back.
  local start_failed=0 failed_project="" failed_status="" ready=1
  if up_both "${tag}"; then
    wait_ready "${tag}" || ready=0
  else
    start_failed=1
    ready=0
    failed_project="${UP_PROJECT}"
    failed_status="${UP_STATUS}"
  fi
  if [ "${ready}" = 0 ]; then
    # 9. The rollback (A-426), each step checked.
    stop_app "${tag}" # r1
    wait_postgres "${current}" || # r2
      restore_fail 26 "${incomplete} budmon holds the restored copy and the data from before the restore is in ${old}; ${runbook}"
    admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS false" >/dev/null || true # r3
    rename_db "${current}" budmon "${failed}" || # r4
      restore_fail 26 "${incomplete} budmon holds the restored copy and the data from before the restore is in ${old}; ${runbook}"
    rename_db "${current}" "${old}" budmon || # r5
      restore_fail 26 "${incomplete} budmon is missing; the data from before the restore is in ${old} and the restored copy in ${failed}; ${runbook}"
    admin_sql "${current}" "ALTER DATABASE \"budmon\" WITH ALLOW_CONNECTIONS true" >/dev/null || # r6
      restore_fail 26 "${incomplete} budmon holds the data from before the restore but refuses connections; ${runbook}"
    rm -f "$(restore_marker)" # r7
    if up_both "${current}"; then # r8
      if [ "${start_failed}" = 1 ]; then
        restore_fail 31 "${tag} didn't start on the restored database (docker compose up -d for ${failed_project} exited ${failed_status}); ${current} and its database are back, maintenance stays on"
      fi
      restore_fail 16 "${tag} isn't ready on the restored database (${READY_FAILED}); ${current} and its database are back, maintenance stays on"
    fi
    if [ "${start_failed}" = 1 ]; then
      restore_fail 17 "${tag} didn't start on the restored database; the database is back but starting ${current} failed: run budmon-local start"
    fi
    restore_fail 17 "${tag} isn't ready on the restored database (${READY_FAILED}); the database is back but starting ${current} failed: run budmon-local start"
  fi

  # 9. Record the switch.
  state_write "${tag}" "${current}"
  link_bin "${tag}"
  rm -f "$(restore_marker)"
  maintenance_off
  say "restored ${name} with ${tag}; the previous database is kept as ${old}"
  : "${previous}"
}
