#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_dotenv_file() {
  local file_path="$1"
  [[ -f "${file_path}" ]] || return 0

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "${line}" ]] || continue
    [[ "${line}" =~ ^# ]] && continue
    [[ "${line}" == *=* ]] || continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "${value}" =~ ^\".*\"$ ]] || [[ "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    if [[ -z "${!key+x}" ]]; then
      export "${key}=${value}"
    fi
  done < "${file_path}"
}

get_lan_ipv4() {
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && $1 != "127.0.0.1" {print $1}'
    return 0
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1
  fi
}


wait_for_database() {
  local max_attempts="${DB_WAIT_ATTEMPTS:-30}"
  local sleep_seconds="${DB_WAIT_INTERVAL:-3}"

  if [[ -z "${DB_HOST:-}" || -z "${DB_USER:-}" || -z "${DB_NAME:-}" ]]; then
    return 0
  fi

  echo "Waiting for database ${DB_HOST}:${DB_PORT:-3306}/${DB_NAME} ..."
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if node - <<'NODE' >/dev/null 2>&1
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    connectTimeout: 5000,
  });
  await conn.query('SELECT 1');
  await conn.end();
})().catch(() => process.exit(1));
NODE
    then
      echo "Database is reachable"
      return 0
    fi

    echo "Database not ready yet (${attempt}/${max_attempts}), retrying in ${sleep_seconds}s ..."
    sleep "${sleep_seconds}"
  done

  echo "Database is still not reachable after $((max_attempts * sleep_seconds))s; starting anyway"
}

cd "${PROJECT_ROOT}"

load_dotenv_file "${PROJECT_ROOT}/server/.env"
load_dotenv_file "${PROJECT_ROOT}/.env"

export DIFY_BASE_URL="${DIFY_BASE_URL:-http://220.154.0.29:8001/v1}"
export PORT="${PORT:-8787}"
export CORS_ORIGIN="${CORS_ORIGIN:-*}"

echo "Starting proxy on http://0.0.0.0:${PORT}"
LAN_IPS="$(get_lan_ipv4 | paste -sd ', ' -)"
if [[ -n "${LAN_IPS}" ]]; then
  echo "LAN IP: ${LAN_IPS}"
fi

wait_for_database

exec node server/server.js
