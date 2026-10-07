#!/usr/bin/env bash
# Exercises protect-paths.sh (and its register-guard.mjs companion) with synthetic
# PreToolUse payloads. Runs entirely inside a disposable temp project dir — copying in
# docs/compliance/register.md and symlinking the real .claude/hooks — so this script
# never reads or writes the real repo's .claude/active-register-ref.
set -uo pipefail

real_root="$(cd "$(dirname "$0")/../.." && pwd)"
hook="$real_root/.claude/hooks/protect-paths.sh"

tmp_root="$(mktemp -d)"
nodir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_root" "$nodir"; }
trap cleanup EXIT

mkdir -p "$tmp_root/docs/compliance" "$tmp_root/.claude"
cp "$real_root/docs/compliance/register.md" "$tmp_root/docs/compliance/register.md"
ln -s "$real_root/.claude/hooks" "$tmp_root/.claude/hooks"

# A PATH with everything protect-paths.sh needs EXCEPT jq, to exercise the fail-closed path.
for b in bash env cat tr grep node realpath; do
  p="$(command -v "$b" 2>/dev/null)" && ln -s "$p" "$nodir/$b"
done

export CLAUDE_PROJECT_DIR="$tmp_root"
ref="$tmp_root/.claude/active-register-ref"
register="$tmp_root/docs/compliance/register.md"

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

expect_env() { # expect_env <exit-code> <PATH> <json-payload> <label>
  printf '%s' "$3" | PATH="$2" "$hook" >/dev/null 2>&1
  local got=$?
  if [[ $got -ne $1 ]]; then echo "FAIL: $4 (expected $1, got $got)"; fail=1; else echo "ok: $4"; fi
}

# --- Baseline: migrations/applied and packages/tax-zm/rates gated by active-register-ref ---

rm -f "$ref"
expect 0 "$tmp_root/packages/ledger/src/post.ts" "ordinary file allowed"
expect 2 "$tmp_root/packages/tax-zm/rates/vat.json" "rates blocked without ref"
expect 2 "$tmp_root/migrations/applied/0001.sql" "applied migration blocked without ref"
echo "ZM-9999" > "$ref"
expect 2 "$tmp_root/packages/tax-zm/rates/vat.json" "rates blocked with unknown ref"
echo "ZM-0001" > "$ref"
expect 0 "$tmp_root/packages/tax-zm/rates/vat.json" "rates allowed with registered ref"
rm -f "$ref"

# --- Register guard: basic Write/Edit/MultiEdit cases (spec §10, no ref bypass) ---

header_line="$(sed -n '1p' "$register")"
prose_line="$(sed -n '3p' "$register")"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:"| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "write of a register row ending VERIFIED is blocked"

expect_raw 2 "$(jq -n --arg path "$register" --arg old "$header_line" \
  --arg new "$header_line
(inserted)
| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:$old,new_string:$new}}')" \
  "edit new_string containing a VERIFIED row is blocked"

expect_raw 0 "$(jq -n --arg path "$register" --arg old "$header_line" \
  --arg new "$header_line
(inserted)
| ZM-0004 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFY |" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:$old,new_string:$new}}')" \
  "edit adding a VERIFY row is allowed"

expect_raw 0 "$(jq -n --arg path "$register" --arg old "$prose_line" \
  --arg new "$prose_line (clarified)" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:$old,new_string:$new}}')" \
  "edit of header prose mentioning VERIFIED is allowed"

echo "ZM-0001" > "$ref"
expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:"| ZM-0001 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "VERIFIED row with ZM-0001 in active-register-ref is still blocked"
rm -f "$ref"

expect_raw 2 "$(jq -n --arg path "$register" --arg anchor "$header_line" \
  '{tool_name:"MultiEdit",tool_input:{file_path:$path,edits:[
    {old_string:$anchor,new_string:$anchor,replace_all:false},
    {old_string:$anchor,new_string:($anchor + "\n(inserted)\n| ZM-0005 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |"),replace_all:false}
  ]}}')" \
  "multiedit with a VERIFIED row in one edit is blocked"

# --- Register guard: the specific bypasses review round 1 found (finding 1) ---

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"VERIFY |",new_string:"VERIFIED |"}}')" \
  "bypass: old/new VERIFY|->VERIFIED| (first occurrence) is blocked"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"VERIFY |",new_string:"VERIFIED |",replace_all:true}}')" \
  "bypass: old/new VERIFY|->VERIFIED| with replace_all is blocked"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:" VERIFY ",new_string:" VERIFIED "}}')" \
  "bypass: substring-only VERIFY->VERIFIED (no pipes in the edit text) is blocked"

cr_content=$'Header\rRow: | ZM-0006 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\r'
expect_raw 2 "$(jq -n --arg path "$register" --arg content "$cr_content" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:$content}}')" \
  "bypass: CR-only line breaks around a VERIFIED row is blocked"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Write",tool_input:{file_path:$path,content:"| ZM-0007 | VERIFIED | Source | 2026-10-07 | impl.ts | impl.test.ts |  | something |\n"}}')" \
  "bypass: VERIFIED in a non-final cell is blocked"

# --- Path normalisation: relative, //, ./ and .. must not evade either guard (finding 2) ---

rm -f "$ref"
expect_raw 2 "$(jq -n --arg p "packages/tax-zm/rates/vat.json" --arg cwd "$tmp_root" \
  '{tool_name:"Edit",tool_input:{file_path:$p},cwd:$cwd}')" \
  "relative rates path resolved against cwd is blocked"

expect_raw 2 "$(jq -n --arg p "$tmp_root//packages/tax-zm/rates/vat.json" \
  '{tool_name:"Edit",tool_input:{file_path:$p}}')" \
  "double-slash rates path is blocked"

expect_raw 2 "$(jq -n --arg p "$tmp_root/./packages/tax-zm/rates/vat.json" \
  '{tool_name:"Edit",tool_input:{file_path:$p}}')" \
  "dot-segment rates path is blocked"

expect_raw 2 "$(jq -n --arg p "$tmp_root/packages/foo/../tax-zm/rates/vat.json" \
  '{tool_name:"Edit",tool_input:{file_path:$p}}')" \
  "dot-dot traversal rates path is blocked"

expect_raw 2 "$(jq -n --arg p "docs/compliance/register.md" --arg cwd "$tmp_root" \
  '{tool_name:"Write",tool_input:{file_path:$p,content:"| ZM-0008 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"},cwd:$cwd}')" \
  "relative register path resolved against cwd is still blocked"

# --- Fails closed on bad input / missing deps (finding 3) ---

expect_raw 2 '{not valid json' "invalid JSON input fails closed"

expect_env 2 "$nodir" "$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$tmp_root/packages/ledger/src/post.ts")" "missing jq fails closed"

# --- Register guard: round 2 findings (empty old_string / non-verbatim old_string) ---

rm -f "$register"
expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"",new_string:"| ZM-0009 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |\n"}}')" \
  "bypass: empty old_string while register.md is missing still blocks a VERIFIED row"
cp "$real_root/docs/compliance/register.md" "$register"

expect_raw 2 "$(jq -n --arg path "$register" \
  '{tool_name:"Edit",tool_input:{file_path:$path,old_string:"ZRA’s guidance (not verbatim in the file)",new_string:"| ZM-0010 | Rule | Source | 2026-10-07 | impl.ts | impl.test.ts |  | VERIFIED |"}}')" \
  "bypass: non-verbatim old_string (e.g. curly-quote mismatch) fails closed, not silent no-op"

exit $fail
