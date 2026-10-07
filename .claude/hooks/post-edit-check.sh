#!/usr/bin/env bash
# PostToolUse: lint the edited TS file and typecheck the workspace; exit 2 feeds errors back to Claude.
# ADVISORY ONLY (security review L3): this hook fails open (missing jq, an unset
# CLAUDE_PROJECT_DIR or a failed cd exits 0) and only fires inside a Claude Code session.
# It is a fast feedback loop, not a control. CI (.github/workflows/ci.yml) is the gate.
set -uo pipefail
path="$(jq -r '.tool_input.file_path // empty')"
[[ "$path" == *.ts || "$path" == *.tsx ]] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out="$(pnpm -s exec eslint "$path" 2>&1 && pnpm -s typecheck 2>&1)"; then
  echo "$out" | tail -40 >&2
  exit 2
fi
