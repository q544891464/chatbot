#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/chatbot/chatbot}"
SERVICE_NAME="${SERVICE_NAME:-chatbot}"
RUN_INSTALL="${RUN_INSTALL:-auto}"
INSTALL_CMD="${INSTALL_CMD:-npm ci --omit=dev}"
RESTART_SERVICE="${RESTART_SERVICE:-1}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:8787/api/health}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
CREATE_SYSTEMD="${CREATE_SYSTEMD:-1}"
SERVICE_USER="${SERVICE_USER:-root}"
SERVICE_GROUP="${SERVICE_GROUP:-root}"

log() {
  printf '[offline-deploy] %s\n' "$*"
}

fail() {
  printf '[offline-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

usage() {
  cat <<EOF
Usage:
  APP_DIR=/home/chatbot/chatbot bash scripts/deploy-offline-bundle.sh /path/chatbot-offline.tar.gz

Environment:
  APP_DIR            Install directory. Default: /home/chatbot/chatbot
  SERVICE_NAME       systemd service name. Default: chatbot
  SERVICE_USER       systemd user. Default: root
  SERVICE_GROUP      systemd group. Default: root
  RUN_INSTALL        auto|1|0. Default: auto
  INSTALL_CMD        Command used when dependencies are absent. Default: npm ci --omit=dev
  CREATE_SYSTEMD     1|0. Default: 1
  RESTART_SERVICE    1|0. Default: 1
  HEALTHCHECK_URL    Empty to skip. Default: http://127.0.0.1:8787/api/health
  NODE_BIN           Node executable path. Default: command -v node
EOF
}

ARCHIVE="${1:-}"
if [[ -z "${ARCHIVE}" || "${ARCHIVE}" == "-h" || "${ARCHIVE}" == "--help" ]]; then
  usage
  exit 0
fi

[[ -f "${ARCHIVE}" ]] || fail "bundle not found: ${ARCHIVE}"
require_cmd tar

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  fail "node not found; install Node.js first or pass NODE_BIN=/path/to/node"
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

log "extracting bundle"
tar -xzf "${ARCHIVE}" -C "${TMP_DIR}"
EXTRACTED_DIR="$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "${EXTRACTED_DIR}" ]] || fail "archive does not contain a top-level directory"
[[ -f "${EXTRACTED_DIR}/package.json" ]] || fail "package.json not found in bundle"
[[ -f "${EXTRACTED_DIR}/server/server.js" ]] || fail "server/server.js not found in bundle"

PARENT_DIR="$(dirname "${APP_DIR}")"
mkdir -p "${PARENT_DIR}"

PRESERVED_ENV_DIR="${TMP_DIR}/preserved-env"
mkdir -p "${PRESERVED_ENV_DIR}"
if [[ -d "${APP_DIR}" ]]; then
  [[ -f "${APP_DIR}/.env" ]] && cp "${APP_DIR}/.env" "${PRESERVED_ENV_DIR}/root.env"
  [[ -f "${APP_DIR}/server/.env" ]] && cp "${APP_DIR}/server/.env" "${PRESERVED_ENV_DIR}/server.env"
  BACKUP_DIR="${APP_DIR}.bak.$(date +%Y%m%d-%H%M%S)"
  log "backing up existing app: ${BACKUP_DIR}"
  mv "${APP_DIR}" "${BACKUP_DIR}"
fi

log "installing app to ${APP_DIR}"
mkdir -p "${APP_DIR}"
tar -C "${EXTRACTED_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -
chmod +x "${APP_DIR}/server/start.sh" 2>/dev/null || true
chmod +x "${APP_DIR}/scripts/"*.sh 2>/dev/null || true
if [[ ! -f "${APP_DIR}/.env" && -f "${PRESERVED_ENV_DIR}/root.env" ]]; then
  log "restoring existing .env"
  cp "${PRESERVED_ENV_DIR}/root.env" "${APP_DIR}/.env"
fi
if [[ ! -f "${APP_DIR}/server/.env" && -f "${PRESERVED_ENV_DIR}/server.env" ]]; then
  log "restoring existing server/.env"
  cp "${PRESERVED_ENV_DIR}/server.env" "${APP_DIR}/server/.env"
fi

cd "${APP_DIR}"

if [[ "${RUN_INSTALL}" == "1" || ( "${RUN_INSTALL}" == "auto" && ! -d node_modules ) ]]; then
  require_cmd npm
  log "installing dependencies: ${INSTALL_CMD}"
  bash -lc "${INSTALL_CMD}"
else
  log "using bundled dependencies"
fi

if [[ "${CREATE_SYSTEMD}" == "1" ]]; then
  [[ "$(id -u)" == "0" ]] || fail "CREATE_SYSTEMD=1 requires root"
  log "writing systemd unit: /etc/systemd/system/${SERVICE_NAME}.service"
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Chatbot H5 Proxy Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/server/start.sh
Restart=always
RestartSec=3
Environment=PATH=$(dirname "${NODE_BIN}"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}" >/dev/null
fi

if [[ "${RESTART_SERVICE}" == "1" ]]; then
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    log "restarting ${SERVICE_NAME}"
    systemctl restart "${SERVICE_NAME}"
  else
    log "systemd service not found; start manually with: ${APP_DIR}/server/start.sh"
  fi
fi

if [[ -n "${HEALTHCHECK_URL}" ]]; then
  require_cmd curl
  log "checking health endpoint: ${HEALTHCHECK_URL}"
  for _ in 1 2 3 4 5; do
    if curl --fail --silent --show-error "${HEALTHCHECK_URL}" >/dev/null; then
      log "health check passed"
      exit 0
    fi
    sleep 2
  done
  fail "health check failed: ${HEALTHCHECK_URL}"
fi

log "deploy completed"
