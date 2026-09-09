# Shared evaluation-key loader for operator submission wrappers.
# Source this file (not execute it). On success it sets EVALUATION_KEY from
# $TMLB_EVALUATION_API_KEY, a hidden prompt, or the mode-0600 key file, and
# installs an EXIT trap that unsets it. On failure it prints why and returns 2.
#
#   SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/eval-key-env.sh" || exit 2
#   TMLB_EVALUATION_API_KEY="$EVALUATION_KEY" node ...

if [[ -n "${EVAL_KEY_ENV_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
EVAL_KEY_ENV_LOADED=1

__eval_key_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
__eval_key_config_home="${XDG_CONFIG_HOME:-${HOME:?HOME is not set}/.config}"
__eval_key_file="${TMLB_EVALUATION_API_KEY_FILE:-$__eval_key_config_home/telemlebench/evaluation-api-key}"

EVALUATION_KEY="${TMLB_EVALUATION_API_KEY:-}"
unset TMLB_EVALUATION_API_KEY
if [[ -z "$EVALUATION_KEY" && -e "$__eval_key_file" ]]; then
  if [[ ! -f "$__eval_key_file" || -L "$__eval_key_file" ]]; then
    printf 'Refusing non-regular evaluation key file: %s\n' "$__eval_key_file" >&2
    return 2 2>/dev/null || exit 2
  fi
  __eval_key_permissions="$(stat -c '%a' "$__eval_key_file")"
  if (( (8#$__eval_key_permissions & 077) != 0 )); then
    printf 'Evaluation key file permissions are too broad (%s); run: chmod 600 %s\n' \
      "$__eval_key_permissions" "$__eval_key_file" >&2
    return 2 2>/dev/null || exit 2
  fi
  IFS= read -r EVALUATION_KEY < "$__eval_key_file"
fi
if [[ -z "$EVALUATION_KEY" ]]; then
  if [[ ! -t 0 ]]; then
    printf 'No evaluation key is available for unattended use. Run: %s/evaluation-key.sh --save\n' \
      "$__eval_key_script_dir" >&2
    return 2 2>/dev/null || exit 2
  fi
  IFS= read -r -s -p "Paste the VALID evaluation API key, then press Enter: " EVALUATION_KEY
  printf '\n'
fi
if [[ -z "$EVALUATION_KEY" ]]; then
  printf 'No key entered.\n' >&2
  return 2 2>/dev/null || exit 2
fi
if [[ "$EVALUATION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  unset EVALUATION_KEY
  printf 'You pasted the SHA-256 digest. Paste the original plaintext key instead.\n' >&2
  return 2 2>/dev/null || exit 2
fi
unset __eval_key_script_dir __eval_key_config_home __eval_key_file __eval_key_permissions

__eval_key_cleanup() {
  unset EVALUATION_KEY
}
trap __eval_key_cleanup EXIT
