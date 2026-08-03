#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

mkdir -p "${PROJECT_ROOT}/data/address-book"
exec 9>"${PROJECT_ROOT}/data/address-book/.sync.lock"
if ! flock -n 9; then
  echo "[address-book] another sync is already running; skipping"
  exit 0
fi

cd "${PROJECT_ROOT}"
exec node scripts/sync-openapi-address-book.js
