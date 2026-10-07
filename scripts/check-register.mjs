import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const AI_SUBSTRINGS = [
  'claude', 'anthropic', 'opus', 'sonnet', 'haiku', 'fable',
  'chatgpt', 'gpt', 'copilot', 'gemini', 'assistant', 'llm', 'bot',
];

function stripOuterPipes(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t;
}

function firstCell(line) {
  const cells = stripOuterPipes(line).split('|');
  return cells[0] !== undefined ? cells[0].trim() : '';
}

function isSeparatorRow(line) {
  const cells = stripOuterPipes(line).split('|');
  return cells.length > 0 && cells.every((c) => /^\s*:?-{3,}:?\s*$/.test(c));
}

function looksLikeTableRow(line) {
  return line.trim().length > 0 && line.includes('|');
}

function isRealIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeVerifiedBy(raw) {
  return raw.normalize('NFKC').replace(/\p{Cf}/gu, '');
}

function containsAiName(text) {
  const lower = text.toLowerCase();
  if (AI_SUBSTRINGS.some((term) => lower.includes(term))) return true;
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes('ai') || tokens.includes('model');
}

function hasNonLatinLetters(name) {
  return /[^\p{Script=Latin}\p{N}\p{P}\p{Zs}]/u.test(name);
}

function checkVerifiedBy(id, raw, errors) {
  const normalized = normalizeVerifiedBy(raw);
  const match = /^([^,]+),([^,]+),\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(normalized);
  if (!match) {
    errors.push(`${id}: VERIFIED needs verified_by "name, qualification, YYYY-MM-DD"`);
    return;
  }
  const [, name, , date] = match;
  if (!isRealIsoDate(date)) {
    errors.push(`${id}: VERIFIED needs verified_by with a real calendar date`);
  }
  if (containsAiName(normalized) || hasNonLatinLetters(name.trim())) {
    errors.push(`${id}: only a human may verify (spec §10)`);
  }
}

function lintRow(line, seen, errors) {
  const cells = stripOuterPipes(line).split('|').map((c) => c.trim());
  if (cells.length !== 8) {
    errors.push(`${line.trim()}: expected 8 columns, got ${cells.length}`);
    return;
  }
  const [id, rule, source, effective, , , verifiedBy, status] = cells;
  if (!/^ZM-\d{4}$/.test(id)) errors.push(`${id}: id must be ZM-NNNN`);
  if (seen.has(id)) errors.push(`${id}: duplicate id`);
  seen.add(id);
  if (!rule) errors.push(`${id}: rule is required`);
  if (!source) errors.push(`${id}: source is required`);
  if (!effective) {
    errors.push(`${id}: effective is required`);
  } else if (!isRealIsoDate(effective)) {
    errors.push(`${id}: effective must be a real ISO date (YYYY-MM-DD)`);
  }
  if (status !== 'VERIFY' && status !== 'VERIFIED') errors.push(`${id}: status must be VERIFY or VERIFIED`);
  if (status === 'VERIFIED') checkVerifiedBy(id, verifiedBy, errors);
}

export function checkRegister(markdown) {
  const errors = [];
  const lines = markdown.split('\n');

  const headerIdx = lines.findIndex((line) => firstCell(line) === 'ID');
  if (headerIdx === -1) {
    errors.push('register: no table found (expected a header row starting with "| ID |")');
    return errors;
  }

  const sepIdx = headerIdx + 1;
  if (!(lines[sepIdx] && isSeparatorRow(lines[sepIdx]))) {
    errors.push('register: header row must be followed by a "|---|" separator row');
  }

  let end = sepIdx + 1;
  while (end < lines.length && looksLikeTableRow(lines[end])) end++;

  const seen = new Set();
  for (let i = sepIdx + 1; i < end; i++) {
    lintRow(lines[i], seen, errors);
  }

  for (let i = 0; i < lines.length; i++) {
    if (i >= headerIdx && i < end) continue;
    if (looksLikeTableRow(lines[i]) && lines[i].includes('VERIFIED')) {
      errors.push(`${lines[i].trim()}: VERIFIED found outside the register table`);
    }
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-register.mjs <register.md>');
    process.exit(2);
  }
  const errors = checkRegister(readFileSync(path, 'utf8'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('register ok');
}
