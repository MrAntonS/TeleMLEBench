#!/usr/bin/env bash
set -euo pipefail

API_BASE="${TMLB_EVALUATION_API_BASE:-https://telemlebench.vercel.app/api/v1}"
CHECK_URL="${API_BASE%/}/evaluations/evaluation-key-check"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME:?HOME is not set}/.config}"
KEY_FILE="${TMLB_EVALUATION_API_KEY_FILE:-$CONFIG_HOME/telemlebench/evaluation-api-key}"

usage() {
  cat <<'EOF'
Check a TeleMLEBench evaluation API key without showing or saving it:

  ./scripts/evaluation-key.sh

Validate and save it for unattended local submissions:

  ./scripts/evaluation-key.sh --save

The key is stored outside the repository with mode 0600. Override its location
with TMLB_EVALUATION_API_KEY_FILE.

Generate a new key and its server-side SHA-256 digest:

  ./scripts/evaluation-key.sh --generate

The plaintext key is used only by the submission client. Add only the digest
to Vercel as TMLB_EVALUATION_API_KEY_SHA256S, then redeploy and run the check.
EOF
}

generate_key() {
  node --input-type=module <<'NODE'
import { createHash, randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(key, 'utf8').digest('hex');

console.log('Evaluation API key (save in a password manager; never commit):');
console.log(key);
console.log('\nVercel TMLB_EVALUATION_API_KEY_SHA256S value:');
console.log(digest);
console.log('\nAfter adding the digest and redeploying, run:');
console.log('./scripts/evaluation-key.sh');
NODE
}

save_key() {
  local key="$1" key_dir temporary
  key_dir="$(dirname -- "$KEY_FILE")"
  umask 077
  mkdir -p -- "$key_dir"
  temporary="$(mktemp "$key_dir/.evaluation-api-key.XXXXXX")"
  trap 'rm -f -- "$temporary"' RETURN
  printf '%s\n' "$key" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$KEY_FILE"
  trap - RETURN
  printf 'Saved evaluation API key to %s (mode 0600).\n' "$KEY_FILE"
}

check_key() {
  local should_save="${1:-false}"
  local key status anonymous_status digest
  IFS= read -r -s -p "Paste evaluation-key candidate, then press Enter: " key
  printf '\n'
  if [[ -z "$key" ]]; then
    printf 'No token entered.\n' >&2
    return 2
  fi
  if [[ "$key" =~ ^[0-9a-fA-F]{64}$ ]]; then
    unset key
    printf 'That is a 64-character SHA-256 digest, not the plaintext evaluation key.\n' >&2
    printf 'Keep the digest in Vercel, but paste the original key printed above it into this prompt.\n' >&2
    return 2
  fi

  digest="$(EVALUATION_KEY="$key" node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
process.stdout.write(
  createHash('sha256').update(process.env.EVALUATION_KEY, 'utf8').digest('hex')
);
NODE
)"

  anonymous_status="$({ CHECK_URL="$CHECK_URL" node --input-type=module <<'NODE'
const response = await fetch(process.env.CHECK_URL, {
  headers: { Accept: 'application/json' },
  cache: 'no-store',
});
process.stdout.write(String(response.status));
NODE
  } 2>/dev/null || true)"

  status="$({ CHECK_URL="$CHECK_URL" EVALUATION_KEY="$key" node --input-type=module <<'NODE'
const response = await fetch(process.env.CHECK_URL, {
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${process.env.EVALUATION_KEY}`,
  },
  cache: 'no-store',
});
process.stdout.write(String(response.status));
NODE
  } 2>/dev/null || true)"
  if [[ "$anonymous_status" != "401" ]]; then
    unset key
    printf 'Could not verify the deployed authentication route (anonymous HTTP %s).\n' \
      "${anonymous_status:-network-error}" >&2
    return 1
  fi
  case "$status" in
    404)
      printf 'VALID: this is a configured TeleMLEBench evaluation API key.\n'
      printf 'Candidate SHA-256: %s\n' "$digest"
      if [[ "$should_save" == "true" ]]; then
        save_key "$key"
      fi
      ;;
    401)
      unset key
      printf 'NOT VALID: this is not a configured evaluation API key.\n'
      printf 'Candidate SHA-256: %s\n' "$digest"
      printf 'The production server has key authentication configured, but it does not contain this digest.\n'
      printf 'Set TMLB_EVALUATION_API_KEY_SHA256S to this digest for Production, then redeploy.\n'
      return 1
      ;;
    503)
      unset key
      printf 'SERVER NOT CONFIGURED: set TMLB_EVALUATION_API_KEY_SHA256S in Vercel and redeploy.\n'
      return 1
      ;;
    *)
      unset key
      printf 'Could not verify the candidate (HTTP %s).\n' "${status:-network-error}" >&2
      return 1
      ;;
  esac
  unset key
}

case "${1:-}" in
  "") check_key ;;
  --save) check_key true ;;
  --generate) generate_key ;;
  --help|-h) usage ;;
  *) usage >&2; exit 2 ;;
esac
