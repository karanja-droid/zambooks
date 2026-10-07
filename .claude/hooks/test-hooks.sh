#!/usr/bin/env bash
# Exercises protect-paths.sh with synthetic PreToolUse payloads.
set -uo pipefail
export CLAUDE_PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
hook="$CLAUDE_PROJECT_DIR/.claude/hooks/protect-paths.sh"
ref="$CLAUDE_PROJECT_DIR/.claude/active-register-ref"
register="$CLAUDE_PROJECT_DIR/docs/compliance/register.md"
fail=0

expect() { # expect <exit-code> <file_path> <label>
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$2" | "$hook" >/dev/null 2>&1
  local got=$?
  if [[ $got -ne $1 ]]; then echo "FAIL: $3 (expected $1, got $got)"; fail=1; else echo "ok: $3"; fi
}

expect_raw() { # expect_raw <exit-code> <json-payload> <label>
  printf '%s' "$2" | "$hook" >/dev/null 2>&1
  local got=$?
  if [[ $got -ne $1 ]]; then echo "FAIL: $3 (expected $1, got $got)"; fail=1; else echo "ok: $3"; fi
}

rm -f "$ref"
expect 0 "$CLAUDE_PROJECT_DIR/packages/ledger/src/post.ts" "ordinary file allowed"
expect 2 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates blocked without ref"
expect 2 "$CLAUDE_PROJECT_DIR/migrations/applied/0001.sql" "applied migration blocked without ref"
echo "ZM-9999" > "$ref"
expect 2 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates blocked with unknown ref"
echo "ZM-0001" > "$ref"
expect 0 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates allowed with registered ref"
rm -f "$ref"

# --- Controller addition: block AI writes of VERIFIED to the compliance register (spec §10) ---

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:"| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "write of a register row ending VERIFIED is blocked"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"old",new_string:"| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "edit new_string containing a VERIFIED row is blocked"

expect_raw 0 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"old",new_string:"| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFY |\n"}}')" \
  "edit adding a VERIFY row is allowed"

expect_raw 0 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"old",new_string:"Spec §10. Claude Code may add `VERIFY` rows; only a named human reviewer may set `VERIFIED`."}}')" \
  "edit of header prose mentioning VERIFIED is allowed"

echo "ZM-0001" > "$ref"
expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:"| ZM-0001 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "VERIFIED row with ZM-0001 in active-register-ref is still blocked"
rm -f "$ref"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"MultiEdit",tool_input:{file_path:$path,edits:[{old_string:"a",new_string:"harmless"},{old_string:"b",new_string:"| ZM-0005 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}]}}')" \
  "multiedit with a VERIFIED row in one edit is blocked"

exit $fail
