#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_PATH="/etc/systemd/system/chatbot-address-book-sync.service"
TIMER_PATH="/etc/systemd/system/chatbot-address-book-sync.timer"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[address-book] run this installer with sudo or as root" >&2
  exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/address-book-sync.env" ]]; then
  echo "[address-book] no dedicated config found; using AUTH_CLIENT_ID/AUTH_CLIENT_SECRET from server/.env" >&2
fi

sed "s|/opt/chatbot|${PROJECT_ROOT}|g" "${PROJECT_ROOT}/deploy/chatbot-address-book-sync.service" > "${SERVICE_PATH}"
install -m 0644 "${PROJECT_ROOT}/deploy/chatbot-address-book-sync.timer" "${TIMER_PATH}"
chmod 0755 "${SCRIPT_DIR}/sync-address-book.sh"
systemctl daemon-reload
systemctl enable --now chatbot-address-book-sync.timer
systemctl start chatbot-address-book-sync.service
systemctl status chatbot-address-book-sync.service --no-pager
systemctl list-timers chatbot-address-book-sync.timer --no-pager
