#!/usr/bin/env bash
# Installs bats-core, bats-support and bats-assert into .tools/bats/ at pinned commits (§10.1 Bash).
# Each repository is cloned at its tag and its HEAD compared with the commit verified upstream on
# 2026-10-07; a moved tag is refused (exit 1). Already-installed copies at the right commit are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST="${ROOT}/.tools/bats"

# name tag commit
PINS=(
  "bats-core v1.12.0 713504bc0224a19b3d7c7958c18dc07f64f54b44"
  "bats-support v0.3.0 24a72e14349690bcbf7c151b9d2d1cdd32d36eb1"
  "bats-assert v2.1.0 78fa631d1370562d2cd4a1390989e706158e7bf0"
)

mkdir -p "${DEST}"
for pin in "${PINS[@]}"; do
  read -r name tag commit <<<"${pin}"
  dir="${DEST}/${name}"
  if [ -d "${dir}/.git" ] && [ "$(git -C "${dir}" rev-parse HEAD)" = "${commit}" ]; then
    continue
  fi
  rm -rf "${dir}"
  git clone --quiet --depth 1 --branch "${tag}" "https://github.com/bats-core/${name}.git" "${dir}" 2>/dev/null
  actual="$(git -C "${dir}" rev-parse HEAD)"
  if [ "${actual}" != "${commit}" ]; then
    echo "setup-bats: ${name} ${tag} is ${actual}, expected ${commit}; refusing a moved tag" >&2
    rm -rf "${dir}"
    exit 1
  fi
done
