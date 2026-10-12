#!/usr/bin/env bash
# Stage-0 tagging (LLD §4.17 "Stage-0 tagging", D-12, A-365): tags a release or hotfix commit and
# pushes the tag. Run from the repository's working tree (a full-history checkout).
#
#   tagRelease.sh release <pr>   a merged release/vX.Y.Z PR: tag vX.Y.Z on the merge commit
#   tagRelease.sh hotfix <pr>    an open hotfix/vX.Y.Z-hotfix.N PR into main with green checks:
#                                tag vX.Y.Z-hotfix.N on the PR's head commit
#
# Exit 0: tagged, or a release PR closed without merge (nothing done). 1: a check failed.
# 64: usage.
set -euo pipefail

usage() {
  echo "Usage: tagRelease.sh release|hotfix <pr number>" >&2
  exit 64
}

fail() {
  echo "tagRelease: $*" >&2
  exit 1
}

main() {
  [ "$#" -eq 2 ] || usage
  local mode="$1" pr="$2"
  case "$mode" in
    release | hotfix) ;;
    *) usage ;;
  esac
  [[ "$pr" =~ ^[0-9]+$ ]] || usage

  local view state head base head_oid merge_oid
  view="$(gh pr view "$pr" --json state,headRefName,baseRefName,headRefOid,mergeCommit)"
  state="$(jq -r '.state' <<<"$view")"
  head="$(jq -r '.headRefName' <<<"$view")"
  base="$(jq -r '.baseRefName' <<<"$view")"
  head_oid="$(jq -r '.headRefOid' <<<"$view")"
  merge_oid="$(jq -r '.mergeCommit.oid // ""' <<<"$view")"

  local tag commit
  if [ "$mode" = "release" ]; then
    if [[ "$head" =~ ^release/(v[0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
      tag="${BASH_REMATCH[1]}"
    else
      fail "branch name invalid: $head"
    fi
    if [ "$state" != "MERGED" ]; then
      echo "tagRelease: pull request $pr was not merged; nothing to tag"
      exit 0
    fi
    [ -n "$merge_oid" ] || fail "pull request $pr has no merge commit"
    commit="$merge_oid"
  else
    local version n
    if [[ "$head" =~ ^hotfix/(v[0-9]+\.[0-9]+\.[0-9]+)-hotfix\.([0-9]+)$ ]]; then
      version="${BASH_REMATCH[1]}"
      n="${BASH_REMATCH[2]}"
      tag="${version}-hotfix.${n}"
    else
      fail "branch name invalid: $head"
    fi
    [ "$state" = "OPEN" ] || fail "pull request not open"
    [ "$base" = "main" ] || fail "base must be main"
    if ! gh pr checks "$pr" --required >/dev/null; then
      fail "checks not green"
    fi
    commit="$head_oid"
    git cat-file -e "${commit}^{commit}" 2>/dev/null || git fetch -q origin "$commit"
    local required=("$version")
    if [ "$n" -gt 1 ]; then required+=("${version}-hotfix.$((n - 1))"); fi
    local t
    for t in "${required[@]}"; do
      if ! git rev-parse -q --verify "refs/tags/$t" >/dev/null ||
        ! git merge-base --is-ancestor "refs/tags/$t" "$commit"; then
        fail "not built on $t"
      fi
    done
  fi

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null ||
    [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
    fail "tag exists: $tag"
  fi

  # Check (i) (F-182) on a checkout of the commit.
  git cat-file -e "${commit}^{commit}" 2>/dev/null || git fetch -q origin "$commit"
  git checkout -q --detach "$commit"
  # A-380: the commit's code runs without the token.
  if ! env -u GH_TOKEN -u GITHUB_TOKEN pnpm install --frozen-lockfile ||
    ! env -u GH_TOKEN -u GITHUB_TOKEN pnpm db:check-migrations; then
    fail "check (i) failed on $commit"
  fi

  git tag "$tag" "$commit"
  # A-380: the token reaches git only for this push, as a one-off header.
  if [ -n "${GH_TOKEN:-}" ]; then
    local auth
    auth="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
    git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}" \
      push -q origin "refs/tags/$tag"
  else
    git push -q origin "refs/tags/$tag"
  fi
  echo "tagRelease: pushed $tag on $commit"
}

# One line: bash has read all of it before main runs, so the checkout above can't change what
# executes next.
main "$@"; exit $?
