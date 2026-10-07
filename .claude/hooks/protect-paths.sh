#!/usr/bin/env bash
# PreToolUse: block edits to applied migrations and statutory rate data unless an active
# register entry is declared (spec §5). Also blocks AI writes of VERIFIED into
# docs/compliance/register.md (spec §10): only a named human may verify.
#
# Fails closed: a missing dependency, unreadable stdin, unparseable JSON or an unresolvable
# path never lets the tool call through. It always exits 2 in that case, never 0 and never
# whatever incidental exit code a failed `jq`/`realpath` happened to return.
#
# Note on the active-register-ref unlock below: it is a speed bump, not a control. The ref
# file lives under the project's own .claude/ and is itself AI-writable, so it only raises
# the bar for an accidental edit; it is not a security boundary. The register guard (which
# this ref can never bypass) plus human PR review are the real controls (spec §10).
set -uo pipefail

fail_closed() {
  echo "Blocked: protect-paths.sh could not safely evaluate this tool call (${1:-unknown reason}). Failing closed." >&2
  exit 2
}

command -v jq >/dev/null 2>&1 || fail_closed "jq not found"
command -v node >/dev/null 2>&1 || fail_closed "node not found"
command -v realpath >/dev/null 2>&1 || fail_closed "realpath not found"

input="$(cat)" || fail_closed "could not read stdin"

# One jq call: validate the JSON and pull every field we need as TSV. Any parse failure or
# unexpected shape makes this `read` fail, which we treat as fail-closed below.
fields="$(jq -r -e '
  [ (.tool_name // ""),
    (.tool_input.file_path // .tool_input.path // .tool_input.notebook_path // ""),
    (.cwd // "") ] | @tsv
' <<<"$input" 2>/dev/null)" || fail_closed "invalid JSON input or unexpected shape"

IFS=$'\t' read -r tool_name raw_path cwd <<<"$fields" || fail_closed "could not parse tool input"

[[ -n "$raw_path" ]] || exit 0 # no target path: nothing to guard

project_dir="${CLAUDE_PROJECT_DIR:-}"
[[ -n "$project_dir" ]] || fail_closed "CLAUDE_PROJECT_DIR is not set"
project_dir="$(realpath -m -s "$project_dir")" || fail_closed "could not normalise CLAUDE_PROJECT_DIR"

# Resolve relative paths against .cwd (falling back to CLAUDE_PROJECT_DIR), then normalise
# with realpath -m -s (no existence requirement, no symlink resolution) so that //, ./ and
# x/.. segments can't dodge the prefix comparisons below.
case "$raw_path" in
  /*) abs_input="$raw_path" ;;
  *) abs_input="${cwd:-$project_dir}/$raw_path" ;;
esac
abs_path="$(realpath -m -s "$abs_input")" || fail_closed "could not normalise target path"

register="$project_dir/docs/compliance/register.md"
rates_dir="$project_dir/packages/tax-zm/rates"
applied_dir="$project_dir/migrations/applied"

# --- Register guard: applies regardless of tool_name, whenever the target IS the register,
# and has no active-register-ref bypass by design (spec §10). ---
if [[ "$abs_path" == "$register" ]]; then
  if ! printf '%s' "$input" | node "$project_dir/.claude/hooks/register-guard.mjs" "$register"; then
    exit 2
  fi
fi

# --- Protected-path guard: migrations/applied/** and packages/tax-zm/rates/** (spec §5). ---
case "$abs_path" in
  "$applied_dir"/*|"$rates_dir"/*)
    ref_file="$project_dir/.claude/active-register-ref"
    if [[ -f "$ref_file" && -f "$register" ]]; then
      ref="$(tr -d '[:space:]' < "$ref_file")"
      if [[ "$ref" =~ ^ZM-[0-9]{4}$ ]] && grep -q "^| $ref |" "$register"; then exit 0; fi
    fi
    echo "Blocked: $abs_path is protected (spec §5). Add or cite a docs/compliance/register.md entry and write its ID to .claude/active-register-ref." >&2
    exit 2 ;;
esac
exit 0
