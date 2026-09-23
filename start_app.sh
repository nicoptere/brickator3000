#!/usr/bin/env bash
# ==============================================================================
# Brickator 3000 — Local Web App Launcher
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DIR}/app"

cd "${APP_DIR}"

if [ ! -d "node_modules" ]; then
  echo "[*] Installing frontend dependencies (one-time setup)..."
  npm install
fi

echo ""
echo "=================================================================="
echo "  🧱 Launching Brickator 3000 Local Development Server"
echo "  ➜  App:    https://localhost:5173/"
echo "=================================================================="
echo ""

npm run dev
