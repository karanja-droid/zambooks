import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRegister } from './check-register.mjs';

const CLI = fileURLToPath(new URL('./check-register.mjs', import.meta.url));

const HEADER = '| ID | Rule | Source | Effective | Implementation | Test | verified_by | Status |';
const SEP = '|---|---|---|---|---|---|---|---|';
const table = (...rows) => [HEADER, SEP, ...rows].join('\n');

const row = (cells) => `| ${cells.join(' | ')} |`;
const ok = ['ZM-0001', 'Rule', 'Source', '2026-01-01', 'impl.ts', 'impl.test.ts', '', 'VERIFY'];

test('accepts a well-formed VERIFY row', () => {
  assert.deepEqual(checkRegister(table(row(ok))), []);
});

test('accepts VERIFIED with a human name, qualification and date', () => {
  const r = [...ok]; r[6] = 'Jane Banda, ZICA FCA, 2026-11-01'; r[7] = 'VERIFIED';
  assert.deepEqual(checkRegister(table(row(r))), []);
});

test('rejects VERIFIED without a proper verified_by', () => {
  const r = [...ok]; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: VERIFIED needs verified_by "name, qualification, YYYY-MM-DD"'],
  );
});

test('rejects VERIFIED by an AI', () => {
  const r = [...ok]; r[6] = 'Claude, AI reviewer, 2026-11-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

// M5: each malformed-row case checked separately, asserting the exact errors produced.

test('rejects an unknown status', () => {
  const r = [...ok]; r[7] = 'APPROVED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: status must be VERIFY or VERIFIED'],
  );
});

test('rejects a row with a missing source', () => {
  const r = [...ok]; r[2] = '';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: source is required'],
  );
});

test('rejects a row with the wrong column count', () => {
  assert.deepEqual(
    checkRegister(table('| ZM-0002 | too | few |')),
    ['| ZM-0002 | too | few |: expected 8 columns, got 3'],
  );
});

test('rejects duplicate ids', () => {
  assert.deepEqual(
    checkRegister(table(row(ok), row(ok))),
    ['ZM-0001: duplicate id'],
  );
});

// I1: the register table is located by its header row, and every row until the
// first non-table line is linted, regardless of leading whitespace, missing
// outer pipes or a malformed id.

test('lints a row that has leading whitespace before the pipe', () => {
  const r = [...ok]; r[6] = 'Claude, AI, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(`  ${row(r)}`)),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('lints a row that has no leading pipe', () => {
  const r = [...ok]; r[6] = 'Claude, AI, 2026-01-01'; r[7] = 'VERIFIED';
  const noLeadingPipe = `${r.join(' | ')} |`;
  assert.deepEqual(
    checkRegister(table(noLeadingPipe)),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('rejects a lowercase id instead of skipping the row', () => {
  const r = [...ok]; r[0] = 'zm-0001';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['zm-0001: id must be ZM-NNNN'],
  );
});

test('rejects an id written with an en dash instead of skipping the row', () => {
  const r = [...ok]; r[0] = 'ZM–0001';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM–0001: id must be ZM-NNNN'],
  );
});

test('rejects a VERIFIED row-like line living outside the register table', () => {
  const outside = '| Old | VERIFIED | row | kept | outside | the | table | body |';
  assert.deepEqual(
    checkRegister(`${outside}\n\n${table(row(ok))}`),
    [`${outside}: VERIFIED found outside the register table`],
  );
});

test('does not flag prose mentioning VERIFIED outside the table', () => {
  const prose = 'The linter checks format only; the control is the hook (which blocks AI writes of VERIFIED).';
  assert.deepEqual(checkRegister(`${prose}\n\n${table(row(ok))}`), []);
});

test('rejects a document with no register table', () => {
  assert.deepEqual(
    checkRegister('# Compliance Register\n\nNo table here.\n'),
    ['register: no table found (expected a header row starting with "| ID |")'],
  );
});

// I2: verified_by is normalized (NFKC, strip \p{Cf}) and checked against a
// case-insensitive substring denylist, a standalone-token check for ai/model,
// and a non-Latin-script check on the name part.

test('rejects VERIFIED by "ClaudeCode"', () => {
  const r = [...ok]; r[6] = 'ClaudeCode, AI, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('rejects VERIFIED by "ChatGPT"', () => {
  const r = [...ok]; r[6] = 'ChatGPT, AI, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('rejects VERIFIED by "Opus 4.5"', () => {
  const r = [...ok]; r[6] = 'Opus 4.5, AI, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('rejects VERIFIED by a name hiding a zero-width character', () => {
  const r = [...ok]; r[6] = 'C​laude, Reviewer, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

test('rejects VERIFIED by a name using a Cyrillic look-alike letter', () => {
  const r = [...ok]; r[6] = 'Сlaude, Reviewer, 2026-01-01'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: only a human may verify (spec §10)'],
  );
});

// M3: the verified_by date must be a real calendar date.

test('rejects a verified_by date with an invalid month and day', () => {
  const r = [...ok]; r[6] = 'Jane Banda, ZICA FCA, 2026-99-99'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: VERIFIED needs verified_by with a real calendar date'],
  );
});

test('rejects a verified_by date that does not exist on the calendar', () => {
  const r = [...ok]; r[6] = 'Jane Banda, ZICA FCA, 2026-02-30'; r[7] = 'VERIFIED';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: VERIFIED needs verified_by with a real calendar date'],
  );
});

// M4: effective is required and must be a real ISO date.

test('rejects a row with a missing effective date', () => {
  const r = [...ok]; r[3] = '';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: effective is required'],
  );
});

test('rejects a row with an invalid effective date', () => {
  const r = [...ok]; r[3] = '2026-02-30';
  assert.deepEqual(
    checkRegister(table(row(r))),
    ['ZM-0001: effective must be a real ISO date (YYYY-MM-DD)'],
  );
});

// M6: the CLI requires a path argument.

test('CLI exits 2 with a usage message when no path is given', () => {
  assert.throws(
    () => execFileSync('node', [CLI], { encoding: 'utf8' }),
    (err) => {
      assert.equal(err.status, 2);
      assert.match(err.stderr, /^usage: check-register\.mjs <register\.md>/);
      return true;
    },
  );
});
