#!/usr/bin/env bash
# Stop: refuse to finish while the unit or invariant suite is red (spec §5).
# ADVISORY ONLY (security review L3): this hook fails open (an unset
# CLAUDE_PROJECT_DIR or a failed cd exits 0) and only fires inside a Claude Code session.
# It is a fast feedback loop, not a control. CI (.github/workflows/ci.yml) is the gate.
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out="$(pnpm -s test 2>&1 && pnpm -s test:invariants 2>&1)"; then
  echo "Refusing to finish: unit/invariant suite is red. Fix it or report the failure to the user." >&2
  echo "$out" | tail -60 >&2
  exit 2
fi
