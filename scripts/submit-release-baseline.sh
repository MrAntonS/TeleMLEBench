#!/usr/bin/env bash
# Submit one release's frozen test_predictions.csv to the trusted evaluator.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/eval-key-env.sh" || exit 2

RELEASE=""
PREDICTIONS=""
RECEIPT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) RELEASE="${2:-}"; shift 2 ;;
    --file) PREDICTIONS="${2:-}"; shift 2 ;;
    --receipt) RECEIPT="${2:-}"; shift 2 ;;
    --help|-h)
      printf 'Usage: %s --release RELEASE_ID --file PREDICTIONS_CSV [--receipt RECEIPT_JSON]\n' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$RELEASE" || -z "$PREDICTIONS" ]]; then
  printf 'Both --release and --file are required.\n' >&2
  exit 2
fi
if [[ ! -f "$PREDICTIONS" ]]; then
  printf 'Missing predictions: %s\n' "$PREDICTIONS" >&2
  exit 1
fi

ARGS=(--release "$RELEASE" --file "$PREDICTIONS")
if [[ -n "$RECEIPT" ]]; then
  RECEIPT_DIR="$(dirname -- "$RECEIPT")"
  mkdir -p -- "$RECEIPT_DIR"
  ARGS+=(--receipt "$RECEIPT")
fi

TMLB_EVALUATION_API_KEY="$EVALUATION_KEY" node "$SCRIPT_DIR/submit-baseline.mjs" "${ARGS[@]}"
