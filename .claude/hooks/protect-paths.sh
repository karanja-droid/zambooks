#!/usr/bin/env bash
# PreToolUse: block edits to applied migrations and statutory rate data unless an active register entry is declared (spec §5).
# Also blocks AI writes of VERIFIED into the compliance register (spec §10): only a named human may verify.
set -euo pipefail
input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"

# Controller addition A: no bypass via active-register-ref for this check.
case "$path" in
  */docs/compliance/register.md)
    case "$tool_name" in
      Write|Edit|MultiEdit)
        strings="$(printf '%s' "$input" | jq -r '
          if .tool_name == "Write" then (.tool_input.content // "")
          elif .tool_name == "Edit" then (.tool_input.new_string // "")
          elif .tool_name == "MultiEdit" then ([.tool_input.edits[]?.new_string // ""] | join("\n"))
          else "" end')"
        if printf '%s\n' "$strings" | grep -Eq '\|[[:space:]]*VERIFIED[[:space:]]*\|?[[:space:]]*$'; then
          echo "Blocked: AI may not write VERIFIED to docs/compliance/register.md (spec §10). Only a named human reviewer may set a register entry's status to VERIFIED." >&2
          exit 2
        fi
        ;;
    esac
    ;;
esac

case "$path" in
  */migrations/applied/*|*/packages/tax-zm/rates/*)
    ref_file="$CLAUDE_PROJECT_DIR/.claude/active-register-ref"
    register="$CLAUDE_PROJECT_DIR/docs/compliance/register.md"
    if [[ -f "$ref_file" && -f "$register" ]]; then
      ref="$(tr -d '[:space:]' < "$ref_file")"
      if [[ "$ref" =~ ^ZM-[0-9]{4}$ ]] && grep -q "^| $ref |" "$register"; then exit 0; fi
    fi
    echo "Blocked: $path is protected (spec §5). Add or cite a docs/compliance/register.md entry and write its ID to .claude/active-register-ref." >&2
    exit 2 ;;
esac
exit 0
