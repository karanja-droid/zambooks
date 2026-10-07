import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { JournalId, UserId } from './ids';
import type { PostedLine } from './model';
import { post } from './post';
import { reverse } from './reverse';
import { ACC, ALICE, BOB, CAROL, draft, demoBooks, testContext, usd, usdZmw } from './testing/fixtures';

function posted() {
  const ctx = testContext();
  const r = post(demoBooks(), draft({
    currency: 'USD',
    fxRate: usdZmw('0.5'),
    lines: [
      { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
      { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
      { accountId: ACC.cash, side: 'CR', amount: usd('0.02') },
    ],
  }), ctx);
  return { ctx, ...r };
}

describe('reverse (§6.5)', () => {
  it('posts a linked mirror journal with sides swapped and identical amounts and rates', () => {
    const { ctx, books, journal } = posted();
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(r.journal).toMatchObject({ reversalOf: journal.id, series: journal.series, number: 2, approverId: BOB, authorId: ALICE, date: '2026-10-20' });
    expect(r.journal.memo).toBe('Reversal of GJ-1');
    expect(r.journal.lines).toHaveLength(journal.lines.length);
    r.journal.lines.forEach((l, i) => {
      const o = journal.lines[i] as PostedLine;
      expect(l.side).toBe(o.side === 'DR' ? 'CR' : 'DR');
      expect(l.functionalAmount.equals(o.functionalAmount)).toBe(true);
      expect(l.txnAmount.equals(o.txnAmount)).toBe(true);
      expect(l).toMatchObject({ accountId: o.accountId, rate: o.rate, rateSource: o.rateSource, rateDate: o.rateDate, isRounding: o.isRounding });
    });
    expect(r.books.reversals.get(journal.id)).toBe(r.journal.id);
  });

  it('leaves the original journal unchanged', () => {
    const { ctx, books, journal } = posted();
    const snapshot = JSON.stringify(journal, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(JSON.stringify(r.books.journals[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
  });

  it('uses a custom memo when given', () => {
    const { ctx, books, journal } = posted();
    expect(reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB, memo: 'Posted twice' }, ctx).journal.memo).toBe('Posted twice');
  });

  it('rejects reversing twice, or reversing a reversal', () => {
    const { ctx, books, journal } = posted();
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(errorCode(() => reverse(r.books, { journalId: journal.id, date: '2026-10-21', authorId: CAROL, approverId: BOB }, ctx))).toBe('ALREADY_REVERSED');
    expect(errorCode(() => reverse(r.books, { journalId: r.journal.id, date: '2026-10-21', authorId: CAROL, approverId: BOB }, ctx))).toBe('ALREADY_REVERSED');
  });

  it.each([
    ['unknown journal', { journalId: JournalId('nope') }, 'UNKNOWN_JOURNAL'],
    ['no author', { authorId: UserId('') }, 'MISSING_AUTHOR'],
    ['self-approved (§8 SoD)', { approverId: ALICE }, 'SOD_VIOLATION'],
    ['no approver (§8 SoD)', { approverId: UserId('') }, 'SOD_VIOLATION'],
    ['impossible date', { date: '2026-02-30' }, 'INVALID_DATE'],
    ['dated before the original', { date: '2026-10-14' }, 'INVALID_DATE'],
    ['into a period with no calendar', { date: '2027-01-05' }, 'NO_PERIOD'],
  ])('rejects %s', (_name, override, code) => {
    const { ctx, books, journal } = posted();
    const req = { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB, ...override };
    expect(errorCode(() => reverse(books, req, ctx))).toBe(code);
  });
});
