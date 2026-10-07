import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRegister } from './check-register.mjs';

const row = (cells) => `| ${cells.join(' | ')} |`;
const ok = ['ZM-0001', 'Rule', 'Source', '2026-01-01', 'impl.ts', 'impl.test.ts', '', 'VERIFY'];

test('accepts a well-formed VERIFY row', () => {
  assert.deepEqual(checkRegister(row(ok)), []);
});

test('accepts VERIFIED with a human name, qualification and date', () => {
  const r = [...ok]; r[6] = 'Jane Banda, ZICA FCA, 2026-11-01'; r[7] = 'VERIFIED';
  assert.deepEqual(checkRegister(row(r)), []);
});

test('rejects VERIFIED without a proper verified_by', () => {
  const r = [...ok]; r[7] = 'VERIFIED';
  assert.match(checkRegister(row(r)).join(), /verified_by/);
});

test('rejects VERIFIED by an AI', () => {
  const r = [...ok]; r[6] = 'Claude, AI reviewer, 2026-11-01'; r[7] = 'VERIFIED';
  assert.match(checkRegister(row(r)).join(), /human/);
});

test('rejects unknown status, missing source, wrong column count and duplicates', () => {
  const bad = [...ok]; bad[7] = 'APPROVED';
  const noSource = [...ok]; noSource[2] = '';
  const errs = checkRegister([row(bad), row(noSource), '| ZM-0002 | too | few |', row(ok), row(ok)].join('\n'));
  assert.match(errs.join('\n'), /status/);
  assert.match(errs.join('\n'), /source/);
  assert.match(errs.join('\n'), /8 columns/);
  assert.match(errs.join('\n'), /duplicate/);
});
