#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV_FILE="${SYNC_ENV_FILE:-${SCRIPT_DIR}/sync-from-github.env}"
if [[ -f "${ENV_FILE}" ]]; then
  printf '[sync] loading config: %s\n' "${ENV_FILE}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line//$'\r'/}"
    line="${line#$'\xef\xbb\xbf'}"
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" == *"="* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "${value}" =~ ^\".*\"$ || "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "${key}=${value}"
  done <"${ENV_FILE}"
fi

APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
TARGET_BRANCH="${1:-${TARGET_BRANCH:-}}"
RUN_INSTALL="${RUN_INSTALL:-1}"
INSTALL_CMD="${INSTALL_CMD:-npm ci --omit=dev}"
RESTART_CMD="${RESTART_CMD:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

log() {
  printf '[sync] %s\n' "$*"
}

fail() {
  printf '[sync] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd git

if [[ "${RUN_INSTALL}" == "1" ]]; then
  require_cmd npm
fi

cd "${APP_DIR}"

git config --global --add safe.directory "${APP_DIR}" >/dev/null 2>&1 || true

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git repository: ${APP_DIR}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "working tree has local changes, aborting to avoid overwriting them"
fi

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -z "${TARGET_BRANCH}" ]]; then
  [[ -n "${CURRENT_BRANCH}" ]] || fail "detached HEAD detected, please pass target branch explicitly"
  TARGET_BRANCH="${CURRENT_BRANCH}"
fi

if [[ -n "${CURRENT_BRANCH}" && "${CURRENT_BRANCH}" != "${TARGET_BRANCH}" ]]; then
  log "switching branch from ${CURRENT_BRANCH} to ${TARGET_BRANCH}"
  git checkout "${TARGET_BRANCH}"
fi

OLD_REV="$(git rev-parse HEAD)"
log "fetching ${REMOTE_NAME}/${TARGET_BRANCH}"
git fetch --prune "${REMOTE_NAME}" "${TARGET_BRANCH}"

REMOTE_REV="$(git rev-parse "${REMOTE_NAME}/${TARGET_BRANCH}")"
if [[ "${OLD_REV}" == "${REMOTE_REV}" ]]; then
  log "already up to date (${TARGET_BRANCH} @ ${OLD_REV})"
else
  log "fast-forwarding ${TARGET_BRANCH} to ${REMOTE_REV}"
  git merge --ff-only "${REMOTE_NAME}/${TARGET_BRANCH}"
fi

NEW_REV="$(git rev-parse HEAD)"
CHANGED_FILES="$(git diff --name-only "${OLD_REV}" "${NEW_REV}" || true)"

if [[ "${RUN_INSTALL}" == "1" ]]; then
  if [[ ! -d node_modules ]] || grep -Eq '(^|/)(package\.json|package-lock\.json)$' <<<"${CHANGED_FILES}"; then
    log "installing dependencies"
    bash -lc "${INSTALL_CMD}"
  else
    log "dependencies unchanged, skipping install"
  fi
fi

if [[ -n "${RESTART_CMD}" ]]; then
  log "running restart command"
  bash -lc "${RESTART_CMD}"
else
  log "restart command not configured, skipping restart"
fi

if [[ -n "${HEALTHCHECK_URL}" ]]; then
  require_cmd curl
  log "checking health endpoint: ${HEALTHCHECK_URL}"
  curl --fail --silent --show-error "${HEALTHCHECK_URL}" >/dev/null
fi

log "sync completed: ${OLD_REV} -> ${NEW_REV}"
