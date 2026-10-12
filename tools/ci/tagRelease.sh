#!/usr/bin/env bash
# Stage-0 tagging (LLD §4.17 "Stage-0 tagging", D-12, A-365, A-407, A-437): checks a release or
# hotfix pull request and names the tag and commit; it never pushes, never checks the commit out and
# runs no pnpm, node or tsx (check (i) is tag.yml's `verify` job). In tag.yml's `resolve` job it
# writes tag= and commit= to $GITHUB_OUTPUT; run locally, it prints them and the commands to finish
# by hand. Run from a full-history checkout of the default branch, with DEFAULT_BRANCH set.
#
#   tagRelease.sh release <pr>   a merged release/vX.Y.Z PR: vX.Y.Z on the merge commit
#   tagRelease.sh hotfix <pr>    an open hotfix/vX.Y.Z-hotfix.N PR into the default branch with
#                                every check green: vX.Y.Z-hotfix.N on the PR's head commit
#
# Exit 0: verified, or a release PR closed without merge (nothing done, no outputs). 1: a check
# failed. 64: usage, or DEFAULT_BRANCH unset.
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
  # A-408: the default branch comes from the workflow (or the owner), never a hard-coded name.
  if [ -z "${DEFAULT_BRANCH:-}" ]; then
    echo "tagRelease: DEFAULT_BRANCH is not set" >&2
    usage
  fi

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
    [ "$base" = "$DEFAULT_BRANCH" ] || fail "base must be the default branch"
    # A-414: every check on the head, at least one, each passed or skipped.
    local checks
    checks="$(gh pr checks "$pr" --json name,bucket)" || fail "checks not green"
    jq -e 'length > 0 and all(.[]; .bucket == "pass" or .bucket == "skipping")' \
      <<<"$checks" >/dev/null || fail "checks not green"
    # N-3: the checks are the head's; a push since the first read would tag an unchecked commit.
    local head_now
    head_now="$(gh pr view "$pr" --json headRefOid --jq .headRefOid)"
    [ "$head_now" = "$head_oid" ] || fail "head changed during the checks: $head_oid -> $head_now"
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

  local remote_tag
  remote_tag="$(git ls-remote --tags origin "refs/tags/$tag")" || fail "git ls-remote failed"
  [ -z "$remote_tag" ] || fail "tag exists: $tag"

  # A-407: the outputs for tag.yml's `tag` job; never a push from here.
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'tag=%s\ncommit=%s\n' "$tag" "$commit" >>"$GITHUB_OUTPUT"
    echo "tagRelease: resolved $tag on $commit"
  else
    printf 'tag=%s\ncommit=%s\n' "$tag" "$commit"
    echo "Resolved. Run check (i) on the commit, then create the tag by hand:"
    echo "  git checkout --detach $commit && pnpm install --frozen-lockfile && pnpm db:check-migrations"
    echo "  git tag $tag $commit"
    echo "  git push origin refs/tags/$tag"
  fi
}

# The body is one function called on the last line, so bash has read all of it before it runs.
main "$@"; exit $?
