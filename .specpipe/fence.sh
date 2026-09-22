#!/usr/bin/env bash
# ATD fence：全量单测 + 类型检查 + 前端构建
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm install --frozen-lockfile
pnpm -F @atd/server exec tsc --noEmit
pnpm -F @atd/server test
pnpm -F @atd/web build
echo "fence: ALL GREEN"
