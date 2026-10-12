#!/usr/bin/env bash
# Root script `test:infra` (A-391): the laptop stack's integration tests, run by CI's infra-int job
# with the runner's sudo and Docker after it builds the three images (A-393). Sets
# BUDMON_INFRA_INT=1, which those files require (they skip elsewhere), and runs only them:
#   TP-15.3 and TP-15.28 (I) and TP-15.22 (I) (fullStack.test.ts), TP-15.13 (caddy.test.ts).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${root}"

export BUDMON_INFRA_INT=1
exec pnpm exec vitest run --project server-int \
  apps/server/test/integration/infra/fullStack.test.ts \
  apps/server/test/integration/infra/caddy.test.ts \
  "$@"
