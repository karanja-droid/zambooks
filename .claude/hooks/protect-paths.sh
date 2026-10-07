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

# Each field is pulled with its own jq call (security review L2): a single TSV read let an
# empty field collapse under IFS whitespace and shift the others, which failed open.
jq -e 'type == "object"' <<<"$input" >/dev/null 2>&1 || fail_closed "invalid JSON input or unexpected shape"
tool_name="$(jq -r '.tool_name // "" | if type == "string" then . else "" end' <<<"$input" 2>/dev/null)" \
  || fail_closed "could not read tool_name"
[[ -n "$tool_name" ]] || fail_closed "empty or missing tool_name"
# First non-empty string among the path fields: an empty file_path must not hide a real path.
raw_path="$(jq -r '[.tool_input.file_path?, .tool_input.path?, .tool_input.notebook_path?]
  | map(select(type == "string" and . != "")) | first // ""' <<<"$input" 2>/dev/null)" \
  || fail_closed "could not read target path"
cwd="$(jq -r '.cwd // "" | if type == "string" then . else "" end' <<<"$input" 2>/dev/null)" \
  || fail_closed "could not read cwd"

[[ -n "$raw_path" ]] || exit 0 # no target path: nothing to guard

project_dir="${CLAUDE_PROJECT_DIR:-}"
[[ -n "$project_dir" ]] || fail_closed "CLAUDE_PROJECT_DIR is not set"

# Resolve relative paths against .cwd (falling back to CLAUDE_PROJECT_DIR).
case "$raw_path" in
  /*) abs_input="$raw_path" ;;
  *) abs_input="${cwd:-$project_dir}/$raw_path" ;;
esac

# Two views of both the target and the project dir (security review M3):
#  - `realpath -m -s`: lexical normalisation only (//, ./, x/.. collapse; symlinks kept), so
#    the path the tool was *given* is checked;
#  - `realpath -m`: every existing symlink resolved, so the file the tool would *actually*
#    write is checked. This catches file symlinks, directory symlinks into protected dirs, a
#    symlinked project root and a CLAUDE_PROJECT_DIR given through a symlink.
# A target is protected if ANY (target view, project view) pair puts it under a protected
# prefix. Comparison uses ASCII case-folded forms so that e.g. Docs/Compliance/Register.md
# cannot alias the register on a case-insensitive filesystem (macOS, Windows).
s_proj="$(realpath -m -s "$project_dir")" || fail_closed "could not normalise CLAUDE_PROJECT_DIR"
r_proj="$(realpath -m "$project_dir")" || fail_closed "could not resolve CLAUDE_PROJECT_DIR"
s_path="$(realpath -m -s "$abs_input")" || fail_closed "could not normalise target path"
r_path="$(realpath -m "$abs_input")" || fail_closed "could not resolve target path"
[[ -n "$s_proj" && -n "$r_proj" && -n "$s_path" && -n "$r_path" ]] || fail_closed "empty normalised path"

lc() { printf '%s' "$1" | LC_ALL=C tr 'A-Z' 'a-z'; }

# Case-folded project-relative forms of the target, one per (target view, project view) pair
# where the target lies inside the project.
rels=()
for p in "$s_path" "$r_path"; do
  lp="$(lc "$p")" || fail_closed "could not case-fold target path"
  for d in "$s_proj" "$r_proj"; do
    ld="$(lc "$d")" || fail_closed "could not case-fold CLAUDE_PROJECT_DIR"
    ld="${ld%/}"
    if [[ "$lp" == "$ld"/* ]]; then rels+=("${lp#"$ld"/}"); fi
  done
done

is_register=0
is_gated=0
for rel in ${rels[@]+"${rels[@]}"}; do
  case "$rel" in
    docs/compliance/register.md) is_register=1 ;;
    migrations/applied/*|packages/tax-zm/rates/*) is_gated=1 ;;
  esac
done

register="$project_dir/docs/compliance/register.md"

# --- Register guard: applies regardless of tool_name, whenever the target IS the register
# (under any alias), and has no active-register-ref bypass by design (spec §10). The guard
# reconstructs the post-edit content from the file the tool would actually write ($r_path).
if (( is_register )); then
  if ! printf '%s' "$input" | node "$project_dir/.claude/hooks/register-guard.mjs" "$r_path"; then
    exit 2
  fi
fi

# --- Protected-path guard: migrations/applied/** and packages/tax-zm/rates/** (spec §5). ---
if (( is_gated )); then
  ref_file="$project_dir/.claude/active-register-ref"
  if [[ -f "$ref_file" && -f "$register" ]]; then
    ref="$(tr -d '[:space:]' < "$ref_file")"
    if [[ "$ref" =~ ^ZM-[0-9]{4}$ ]] && grep -q "^| $ref |" "$register"; then exit 0; fi
  fi
  echo "Blocked: $abs_input is protected (spec §5). Add or cite a docs/compliance/register.md entry and write its ID to .claude/active-register-ref." >&2
  exit 2
fi
exit 0
