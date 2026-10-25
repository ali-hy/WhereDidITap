#!/usr/bin/env bash
# A-367: installs actionlint 1.7.12 into <repo>/.tools/actionlint/ (git-ignored), checked against the
# pinned SHA-256 before unpacking. Does nothing when the binary is already there.
set -euo pipefail

VERSION=1.7.12
SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$ROOT/.tools/actionlint"

if [ -x "$DEST/actionlint" ]; then
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/actionlint.tar.gz" \
  "https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_linux_amd64.tar.gz"
echo "${SHA256}  $tmp/actionlint.tar.gz" | sha256sum -c - >/dev/null
tar -xzf "$tmp/actionlint.tar.gz" -C "$tmp" actionlint
mkdir -p "$DEST"
install -m 0755 "$tmp/actionlint" "$DEST/actionlint"
