#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
OUT_DIR="${OUT_DIR:-${APP_DIR}/dist/offline}"
INCLUDE_ENV="${INCLUDE_ENV:-0}"
INCLUDE_NODE_MODULES="${INCLUDE_NODE_MODULES:-1}"
RUN_INSTALL="${RUN_INSTALL:-1}"
INSTALL_CMD="${INSTALL_CMD:-npm ci --omit=dev}"

timestamp() {
  date +"%Y%m%d-%H%M%S"
}

log() {
  printf '[offline-build] %s\n' "$*"
}

fail() {
  printf '[offline-build] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd tar

cd "${APP_DIR}"

if [[ "${RUN_INSTALL}" == "1" ]]; then
  require_cmd npm
  log "installing production dependencies: ${INSTALL_CMD}"
  bash -lc "${INSTALL_CMD}"
fi

if [[ "${INCLUDE_NODE_MODULES}" == "1" && ! -d "${APP_DIR}/node_modules" ]]; then
  fail "node_modules is missing; run with RUN_INSTALL=1 or set INCLUDE_NODE_MODULES=0"
fi

mkdir -p "${OUT_DIR}"

REV="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
BUNDLE_NAME="${BUNDLE_NAME:-chatbot-offline-${REV}-$(timestamp)}"
STAGING_PARENT="$(mktemp -d)"
STAGING_DIR="${STAGING_PARENT}/${BUNDLE_NAME}"
mkdir -p "${STAGING_DIR}"

log "copying project into staging directory"
TAR_EXCLUDES=(
  --exclude='./.git'
  --exclude='./.codex_tmp'
  --exclude='./dist'
  --exclude='./server/logs'
  --exclude='./scripts/sync-from-github.env'
  --exclude='./.codex_tmp_oauth_manual.pdf'
  --exclude='./docs/oauth-login-extract.md'
)
if [[ "${INCLUDE_ENV}" != "1" ]]; then
  TAR_EXCLUDES+=(--exclude='./.env' --exclude='./server/.env')
fi
if [[ "${INCLUDE_NODE_MODULES}" != "1" ]]; then
  TAR_EXCLUDES+=(--exclude='./node_modules')
fi

tar "${TAR_EXCLUDES[@]}" -cf - . | tar -xf - -C "${STAGING_DIR}"

cat >"${STAGING_DIR}/OFFLINE_BUNDLE.txt" <<EOF
name=${BUNDLE_NAME}
source_dir=${APP_DIR}
git_rev=${REV}
created_at=$(date -Iseconds)
include_env=${INCLUDE_ENV}
include_node_modules=${INCLUDE_NODE_MODULES}
EOF

ARCHIVE="${OUT_DIR}/${BUNDLE_NAME}.tar.gz"
log "creating archive: ${ARCHIVE}"
tar -C "${STAGING_PARENT}" -czf "${ARCHIVE}" "${BUNDLE_NAME}"
rm -rf "${STAGING_PARENT}"

log "done"
printf '%s\n' "${ARCHIVE}"
