#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PREDICTIONS="$FRONTEND_ROOT/../TeleCom/reproductions/ujindoorloc-floor-v1/test_predictions.csv"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME:?HOME is not set}/.config}"
KEY_FILE="${TMLB_EVALUATION_API_KEY_FILE:-$CONFIG_HOME/telemlebench/evaluation-api-key}"

if [[ ! -f "$PREDICTIONS" ]]; then
  printf 'Missing predictions: %s\n' "$PREDICTIONS" >&2
  exit 1
fi

EVALUATION_KEY="${TMLB_EVALUATION_API_KEY:-}"
unset TMLB_EVALUATION_API_KEY
if [[ -z "$EVALUATION_KEY" && -e "$KEY_FILE" ]]; then
  if [[ ! -f "$KEY_FILE" || -L "$KEY_FILE" ]]; then
    printf 'Refusing non-regular evaluation key file: %s\n' "$KEY_FILE" >&2
    exit 2
  fi
  permissions="$(stat -c '%a' "$KEY_FILE")"
  if (( (8#$permissions & 077) != 0 )); then
    printf 'Evaluation key file permissions are too broad (%s); run: chmod 600 %s\n' \
      "$permissions" "$KEY_FILE" >&2
    exit 2
  fi
  IFS= read -r EVALUATION_KEY < "$KEY_FILE"
fi
if [[ -z "$EVALUATION_KEY" ]]; then
  if [[ ! -t 0 ]]; then
    printf 'No evaluation key is available for unattended use. Run: %s/evaluation-key.sh --save\n' \
      "$SCRIPT_DIR" >&2
    exit 2
  fi
  IFS= read -r -s -p "Paste the VALID evaluation API key, then press Enter: " EVALUATION_KEY
  printf '\n'
fi
if [[ -z "$EVALUATION_KEY" ]]; then
  printf 'No key entered.\n' >&2
  exit 2
fi
if [[ "$EVALUATION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  unset EVALUATION_KEY
  printf 'You pasted the SHA-256 digest. Paste the original plaintext key instead.\n' >&2
  exit 2
fi

cleanup() {
  unset EVALUATION_KEY
}
trap cleanup EXIT

TMLB_EVALUATION_API_KEY="$EVALUATION_KEY" node "$SCRIPT_DIR/submit-baseline.mjs" \
  --release ujindoorloc-floor-v1 \
  --file "$PREDICTIONS" \
  --receipt /tmp/opencode/ujindoorloc-private-evaluation.json
