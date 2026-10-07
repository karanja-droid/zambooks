#!/usr/bin/env node
// Companion to protect-paths.sh: decides whether a Write/Edit/MultiEdit/… tool call
// would introduce a VERIFIED status into docs/compliance/register.md (spec §10).
//
// Reads the PreToolUse JSON payload on stdin. Takes the absolute register.md path as argv[2].
// Reconstructs the file's POST-EDIT content (not just the new text fragment the tool
// supplies) so that substring-only edits (e.g. old_string "VERIFY |" -> new_string
// "VERIFIED |", or old_string " VERIFY " -> new_string " VERIFIED ") can't hide the
// resulting row from detection. Exits 0 if safe, 2 if it would introduce a new VERIFIED
// cell, and 2 (fail closed) if the input can't be understood at all — including when an
// Edit/MultiEdit step's old_string isn't found verbatim in the current file: we can't
// assume the real tool call also fails (e.g. curly-quote normalisation), so we refuse to
// treat the file as unchanged (fix round 2, finding A).

import fs from "node:fs";

function fail(reason) {
  process.stderr.write(
    `Blocked: register-guard.mjs could not safely evaluate this edit to docs/compliance/register.md (${reason}). Failing closed.\n`,
  );
  process.exit(2);
}

const registerPath = process.argv[2];
if (!registerPath) fail("missing register path argument");

let raw;
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  fail("could not read stdin");
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  fail("invalid JSON input");
}

const toolInput = (payload && typeof payload === "object" && payload.tool_input) || {};

let preContent = "";
try {
  if (fs.existsSync(registerPath)) preContent = fs.readFileSync(registerPath, "utf8");
} catch {
  fail("could not read current register.md");
}

function applyReplace(content, oldStr, newStr, replaceAll) {
  if (typeof newStr !== "string") return content;
  if (typeof oldStr !== "string" || oldStr === "") {
    // An empty old_string means Edit/MultiEdit is writing the whole file from new_string
    // (e.g. the register doesn't exist yet) — identical in effect to Write. Treating this
    // as "unchanged" (as earlier code did) silently hid new_string's content, including any
    // VERIFIED row, from detection. Fix round 2, finding A.
    return newStr;
  }
  if (replaceAll) {
    if (!content.includes(oldStr)) {
      fail("old_string not found verbatim in the current register.md (replace_all) — cannot reconstruct the post-edit file");
    }
    return content.split(oldStr).join(newStr);
  }
  const idx = content.indexOf(oldStr);
  if (idx === -1) {
    // Not found verbatim. We can't assume the real tool call also fails: e.g. an editor that
    // normalises curly quotes to straight ones before matching can still succeed here even
    // though our strict indexOf() doesn't. Silently treating the file as unchanged (as
    // earlier code did) would let such a non-verbatim old_string flip a row to VERIFIED
    // without us ever inspecting the result. Fail closed instead. Fix round 2, finding A.
    fail("old_string not found verbatim in the current register.md — cannot reconstruct the post-edit file");
  }
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
}

let postContent;
if (typeof toolInput.content === "string") {
  // Write: the tool supplies the whole new file.
  postContent = toolInput.content;
} else if (Array.isArray(toolInput.edits)) {
  // MultiEdit: apply each step in order against the current file.
  postContent = preContent;
  for (const edit of toolInput.edits) {
    if (!edit || typeof edit !== "object" || typeof edit.new_string !== "string") continue;
    postContent = applyReplace(postContent, edit.old_string, edit.new_string, !!edit.replace_all);
  }
} else if (typeof toolInput.new_string === "string") {
  // Edit: apply the single step against the current file.
  postContent = applyReplace(preContent, toolInput.old_string, toolInput.new_string, !!toolInput.replace_all);
} else {
  // Unknown shape targeting the register: can't compute the resulting content. Fail closed.
  fail("unrecognized tool_input shape for a register.md write");
}

function splitLines(s) {
  return s.split(/\r\n|\r|\n/);
}

function normaliseCell(cell) {
  return cell
    .trim()
    .replace(/^[*`]+/, "")
    .replace(/[*`]+$/, "")
    .trim()
    .toUpperCase();
}

const preLines = new Set(splitLines(preContent));
const postLines = splitLines(postContent);

let offending = null;
for (const line of postLines) {
  if (!line.includes("|")) continue; // header prose etc: never a row, never checked
  const cells = line.split("|");
  const hasVerified = cells.some((cell) => normaliseCell(cell) === "VERIFIED");
  if (!hasVerified) continue;
  // already present verbatim before this edit: not newly introduced by this tool call.
  // By design this means any AI edit that CHANGES an existing VERIFIED row (its source,
  // date, implementation path, etc.) is still blocked: the edited line's text no longer
  // matches the pre-edit line verbatim, so it falls through to "offending" below. A change
  // to a verified row requires a human to re-verify it, not just re-approve an AI edit.
  if (preLines.has(line)) continue;
  offending = line;
  break;
}

if (offending) {
  process.stderr.write(
    `Blocked: AI may not write VERIFIED to docs/compliance/register.md (spec §10). ` +
      `Only a named human reviewer may set a register entry's status to VERIFIED.\nOffending row: ${offending.trim()}\n`,
  );
  process.exit(2);
}

process.exit(0);
