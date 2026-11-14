#!/usr/bin/env bash
# Download official LDraw parts & LDConfig.ldr into dataset/ldraw/
# Usage: bash dataset/download_ldraw.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$DIR/download_ldraw.py" "$@"
