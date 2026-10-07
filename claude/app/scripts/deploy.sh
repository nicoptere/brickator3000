#!/usr/bin/env bash
# ==============================================================================
# Brickagen 3000 (claude/app) — GCS Deployment Script
# Target: gs://nicoptere/2026/lego/brickagen
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DIR}"

BUCKET="gs://nicoptere/2026/lego/brickagen"
PUBLIC_URL="https://storage.googleapis.com/nicoptere/2026/lego/brickagen/index.html"

MODE="${1:-quick}"

echo "=================================================================="
echo "  🧱 Brickagen 3000 Deployment"
echo "  Mode:   ${MODE}"
echo "  Target: ${BUCKET}"
echo "=================================================================="

# 1. Build application (triggers prebuild -> build_manifest.mjs -> vite build)
echo "[1/4] Building production bundle..."
npm run build

# 2. Upload application files based on mode
if [ "${MODE}" == "all" ]; then
  echo "[2/4] Full sync of dist and clean models library..."
  gcloud storage rsync -r dist "${BUCKET}"
  if [ -d "../../discretizer/public/models/clean" ]; then
    echo "Syncing 3D clean models library to ${BUCKET}/models/clean..."
    gcloud storage rsync -r "../../discretizer/public/models/clean" "${BUCKET}/models/clean"
  fi
elif [ "${MODE}" == "models" ]; then
  echo "[2/4] Syncing 3D clean models library to ${BUCKET}/models/clean..."
  if [ -d "../../discretizer/public/models/clean" ]; then
    gcloud storage rsync -r "../../discretizer/public/models/clean" "${BUCKET}/models/clean"
  fi
else
  gcloud storage cp dist/index.html "${BUCKET}/index.html"
  if [ -f "dist/brickagen3000.jpeg" ]; then
    gcloud storage cp dist/brickagen3000.jpeg "${BUCKET}/brickagen3000.jpeg"
  fi
  gcloud storage rsync -r dist/assets "${BUCKET}/assets"
  gcloud storage rsync -r dist/env "${BUCKET}/env"
  gcloud storage rsync -r dist/sounds "${BUCKET}/sounds"
  gcloud storage rsync -r dist/models "${BUCKET}/models"
fi

# 3. Cache headers
echo "[3/4] Setting optimal Cache-Control headers..."
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" "${BUCKET}/index.html" >/dev/null 2>&1 || true
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" "${BUCKET}/models/models.json" >/dev/null 2>&1 || true
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" "${BUCKET}/models/clean_manifest.json" >/dev/null 2>&1 || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "${BUCKET}/assets/*" >/dev/null 2>&1 || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "${BUCKET}/sounds/*" >/dev/null 2>&1 || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "${BUCKET}/env/*" >/dev/null 2>&1 || true
gsutil setmeta -h "Cache-Control:public, max-age=86400" "${BUCKET}/brickagen3000.jpeg" >/dev/null 2>&1 || true

# 4. Verify deployment
echo "[4/4] Verifying public endpoint..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC_URL}" || true)

echo ""
echo "=================================================================="
if [ "${STATUS}" == "200" ]; then
  echo "  ✅ Deployment verified! HTTP ${STATUS}"
else
  echo "  ⚠️ Deployment uploaded. HTTP ${STATUS} (may take a moment to propagate)"
fi
echo "  ➜  Public URL: ${PUBLIC_URL}"
echo "=================================================================="
