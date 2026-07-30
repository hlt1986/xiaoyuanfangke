#!/usr/bin/env bash
set -euo pipefail

SITE_URL="${SITE_URL:-http://localhost:3000}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-root}"
DB_NAME="${DB_NAME:-xiaoyuanfangke}"
PORT="${PORT:-3000}"
APP_NAME="${APP_NAME:-xiaoyuanfangke}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_PATH="$PROJECT_ROOT/.env"

log() {
  echo "[deploy-linux] $*"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1. $2" >&2
    exit 1
  fi
}

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

log "Project root: $PROJECT_ROOT"
need_cmd node "Install Node.js 20+ first."
need_cmd pnpm "Install pnpm first: npm install -g pnpm"

if [ ! -f "$ENV_PATH" ]; then
  log "Creating .env"
  cat > "$ENV_PATH" <<EOF
PORT=$PORT
BASE_URL=$SITE_URL

DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME

SESSION_SECRET=$(new_secret)
EOF
else
  log ".env already exists, keeping it unchanged."
fi

cd "$PROJECT_ROOT"
log "Installing dependencies."
pnpm install

log "Initializing database."
node -e "const { start, stop } = require('./src/server'); (async()=>{const s=await start(); await stop(s);})().catch(e=>{console.error(e); process.exit(1);});"

if command -v pm2 >/dev/null 2>&1; then
  log "Starting with PM2."
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 start src/server.js --name "$APP_NAME"
  pm2 save || true
  log "PM2 started. Run 'pm2 logs $APP_NAME' to view logs."
else
  log "PM2 not found. Install it with: npm install -g pm2"
  log "Then start with: pm2 start src/server.js --name $APP_NAME && pm2 save"
fi

log "Deployment finished. Open: $SITE_URL"
