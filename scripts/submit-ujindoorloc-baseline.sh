#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PREDICTIONS="$FRONTEND_ROOT/../TeleCom/reproductions/ujindoorloc-floor-v1/test_predictions.csv"

exec "$SCRIPT_DIR/submit-release-baseline.sh" \
  --release ujindoorloc-floor-v1 \
  --file "$PREDICTIONS" \
  --receipt /tmp/opencode/ujindoorloc-private-evaluation.json
