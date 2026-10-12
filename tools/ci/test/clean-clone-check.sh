#!/usr/bin/env bash
# TP-0.6 (S-0, LLD §10.2): `pnpm install && pnpm check` passes on a fresh clone (S-0 AC-1).
#
# Clones the committed state of this repository (HEAD, or the ref given as $1) into a temporary
# directory, so untracked and ignored files (node_modules, dist, .env) can't make it pass, then
# runs `pnpm install --frozen-lockfile` (the lockfile must be committed and current, §2.4) and
# `pnpm check`. Exits with the first failing command's status.
#
# Not a Vitest test: `pnpm check` runs the Vitest suites, so a Vitest test running it would
# recurse. CI's `check` job runs the same commands on a fresh checkout.
#
# Usage: tools/ci/test/clean-clone-check.sh [ref]
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
ref="${1:-HEAD}"
commit="$(git -C "$repo_root" rev-parse --verify "${ref}^{commit}")"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/budmon-clean-clone.XXXXXX")"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

echo "TP-0.6: cloning ${commit} into ${work_dir}"
git clone --quiet --no-hardlinks "$repo_root" "$work_dir/budmon"
git -C "$work_dir/budmon" checkout --quiet --detach "$commit"

cd "$work_dir/budmon"
echo "TP-0.6: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
echo "TP-0.6: pnpm check"
pnpm check
echo "TP-0.6: passed"
