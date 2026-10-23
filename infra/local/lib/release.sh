# shellcheck shell=bash
# budmon-local (F-178): release tags, the build worktree, release copies and images.

check_tag_format() {
  [[ "$1" =~ ${TAG_PATTERN} ]] || die 10 "not a release tag: $1"
}

# Phase A step 2: a release tag is in origin's default branch; a hotfix tag in
# origin/hotfix/<tag> or, after its merge-back, the default branch. A-408: the default branch is
# origin/HEAD, refreshed from the remote, never a hard-coded name.
check_tag_ancestry() {
  local tag="$1" ref
  git -C "${BUDMON_REPO}" fetch --tags origin >/dev/null 2>&1 || die 11 "git fetch failed"
  git -C "${BUDMON_REPO}" remote set-head origin --auto >/dev/null 2>&1 ||
    die 11 "can't resolve origin's default branch"
  local refs=(origin/HEAD)
  [[ "${tag}" == *-hotfix.* ]] && refs=("origin/hotfix/${tag}" origin/HEAD)
  for ref in "${refs[@]}"; do
    if git -C "${BUDMON_REPO}" merge-base --is-ancestor "${tag}" "${ref}" >/dev/null 2>&1; then
      return 0
    fi
  done
  die 11 "${tag} is not on ${refs[*]}"
}

build_dir() {
  echo "${BUDMON_HOME}/build/$1"
}

# Phase A step 3: a detached worktree of the tag (kept when an earlier step made it).
make_worktree() {
  local tag="$1" dir
  dir="$(build_dir "${tag}")"
  if [ -d "${dir}" ]; then
    # A-428: reused only at the tag's commit; otherwise recreated.
    local want have
    want="$(git -C "${BUDMON_REPO}" rev-parse -q --verify "refs/tags/${tag}^{commit}" 2>/dev/null)" || want=""
    have="$(git -C "${dir}" rev-parse HEAD 2>/dev/null)" || have=""
    if [ -n "${want}" ] && [ "${have}" = "${want}" ]; then
      return 0
    fi
    if ! git -C "${BUDMON_REPO}" worktree remove --force "${dir}" >/dev/null 2>&1; then
      rm -rf "${dir}"
      git -C "${BUDMON_REPO}" worktree prune
    fi
  fi
  mkdir -p "${BUDMON_HOME}/build"
  git -C "${BUDMON_REPO}" worktree add --detach "${dir}" "${tag}" >/dev/null 2>&1 ||
    die 11 "git worktree add failed for ${tag}"
}

# Phase A step 4: build/<tag>/infra/local without test/ and rehearsal/ → releases/<tag>/, with
# RELEASE. An existing copy of another commit is exit 12.
copy_release() {
  local tag="$1" src dest commit existing
  src="$(build_dir "${tag}")/infra/local"
  dest="$(release_dir "${tag}")"
  commit="$(git -C "$(build_dir "${tag}")" rev-parse HEAD)"
  if [ -f "${dest}/RELEASE" ]; then
    existing="$(sed -n 's/^commit=//p' "${dest}/RELEASE")"
    [ "${existing}" = "${commit}" ] || die 12 "releases/${tag} is commit ${existing}, not ${commit}"
    return 0
  fi
  rm -rf "${dest}"
  mkdir -p "${dest}"
  (cd "${src}" && tar --exclude=./test --exclude=./rehearsal -cf - .) | (cd "${dest}" && tar -xf -)
  printf 'tag=%s\ncommit=%s\n' "${tag}" "${commit}" >"${dest}/RELEASE"
  find "${dest}" -type d -exec chmod 0755 {} +
  find "${dest}" -type f -exec chmod 0644 {} +
  chmod 0755 "${dest}/budmon-local"
}

images_present() {
  local tag="$1" name
  for name in server web postgres; do
    docker image inspect "budmon/${name}:${tag}" >/dev/null 2>&1 || return 1
  done
}

# Phase B step 1: the three images from build/<tag>, then the worktree is removed. Records
# whether the release carries apps/server/QUEUE_UPGRADE in QUEUE_UPGRADE (0 or 1).
build_images() {
  local tag="$1" dir count
  dir="$(build_dir "${tag}")"
  # shellcheck disable=SC2034 # read by cmd_upgrade_continue
  QUEUE_UPGRADE=0
  if [ ! -d "${dir}" ]; then
    # Already built (install step 10 before its phase B, or a restore of a built release).
    images_present "${tag}" && return 0
    die 13 "build/${tag} is missing and the images aren't built"
  fi
  # shellcheck disable=SC2034 # read by cmd_upgrade_continue
  [ -e "${dir}/apps/server/QUEUE_UPGRADE" ] && QUEUE_UPGRADE=1
  # A-423: the web image's Sentry DSN, read from site.env (never sourced).
  local web_dsn
  # A missing or unreadable site.env reads as "not set" (pipefail would otherwise exit silently).
  web_dsn=""
  if [ -r "${BUDMON_HOME}/site.env" ]; then
    web_dsn="$(sed -n 's/^WEB_SENTRY_DSN=//p' "${BUDMON_HOME}/site.env" | tail -n 1)" || web_dsn=""
  fi
  if [ -z "${web_dsn}" ] || [ "${web_dsn}" = "${PLACEHOLDER}" ]; then
    die 13 "site.env: WEB_SENTRY_DSN not set"
  fi
  count="$(git -C "${dir}" rev-list --count "${tag}")"
  docker build -f "${dir}/images/server/Dockerfile" -t "budmon/server:${tag}" "${dir}" ||
    die 13 "docker build of the server image failed"
  docker build -f "${dir}/images/web/Dockerfile" --build-arg "BUDMON_BUILD_NUMBER=${count}" \
    --build-arg "VITE_SENTRY_DSN=${web_dsn}" \
    -t "budmon/web:${tag}" "${dir}" || die 13 "docker build of the web image failed"
  docker build --build-context "sql=${dir}/apps/server/src/platform/db/sql" \
    -t "budmon/postgres:${tag}" "${dir}/images/postgres" ||
    die 13 "docker build of the postgres image failed"
  git -C "${BUDMON_REPO}" worktree remove --force "${dir}" >/dev/null 2>&1 || true
  rm -rf "${dir}"
}

# Keeps the newest 5 release copies (version order), never current or previous.
prune_releases() {
  local current="$1" previous="$2" keep=5 tag kept=0
  local others=()
  while IFS= read -r tag; do
    [ -z "${tag}" ] && continue
    [ "${tag}" = "${current}" ] || [ "${tag}" = "${previous}" ] && continue
    others+=("${tag}")
  done < <(find "${BUDMON_HOME}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -rV)
  kept=1
  [ -n "${previous}" ] && [ -d "$(release_dir "${previous}")" ] && kept=2
  for tag in "${others[@]}"; do
    if [ "${kept}" -lt "${keep}" ]; then
      kept=$((kept + 1))
    else
      rm -rf "$(release_dir "${tag}")"
    fi
  done
}

# Keeps the newest 5 regular dumps; _pre-restore dumps are never pruned.
prune_dumps() {
  local f n=0
  while IFS= read -r f; do
    [ -z "${f}" ] && continue
    n=$((n + 1))
    if [ "${n}" -gt 5 ]; then rm -f "${BUDMON_HOME}/dumps/${f}"; fi
  done < <(find "${BUDMON_HOME}/dumps" -maxdepth 1 -type f -printf '%f\n' |
    grep -E '^[0-9]{8}T[0-9]{6}Z_v[^_]+\.dump$' | sort -r)
  return 0
}
