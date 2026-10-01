#!/usr/bin/env bash
# ==============================================================================
# Brickator 3000 Markov Studio — GCS Deployment Script
# Target: gs://nicoptere/2026/lego/generator
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DIR}"

BUCKET="gs://nicoptere/2026/lego/generator"
PUBLIC_URL="https://storage.googleapis.com/nicoptere/2026/lego/generator/index.html"

MODE="${1:-quick}"

echo "=================================================================="
echo "  🧱 Brickator Markov Studio Deployment"
echo "  Mode:   ${MODE}"
echo "  Target: ${BUCKET}"
echo "=================================================================="

# 1. Build application
echo "[1/3] Building production assets (tsc && vite build)..."
npm run build

# 2. Upload based on mode
if [ "${MODE}" == "all" ]; then
  echo "[2/3] Full sync (rsync only uploads new or modified files)..."
  gcloud storage rsync -r dist "${BUCKET}"
else
  echo "[2/3] Selective upload: syncing only HTML, compiled JS/CSS bundles, and sounds..."
  gcloud storage cp dist/index.html "${BUCKET}/index.html"
  gcloud storage rsync -r dist/assets "${BUCKET}/assets"
  gcloud storage rsync -r dist/sounds "${BUCKET}/sounds"
fi

# 3. Cache headers
echo "[3/3] Setting optimal Cache-Control headers..."
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" "${BUCKET}/index.html" >/dev/null 2>&1 || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "${BUCKET}/assets/*" >/dev/null 2>&1 || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "${BUCKET}/sounds/*" >/dev/null 2>&1 || true

echo ""
echo "=================================================================="
echo "  ✅ Deployment complete!"
echo "  ➜  Public URL: ${PUBLIC_URL}"
echo "=================================================================="
