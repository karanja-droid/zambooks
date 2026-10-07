import { errorCode, sumMoney } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { post } from './post';
import { ACC, ALICE, CO, draft, demoBooks, testContext, usd, usdZmw } from './testing/fixtures';

describe('post', () => {
  it('numbers journals gaplessly per series (§6.7)', () => {
    const ctx = testContext();
    let books = demoBooks();
    const numbers: string[] = [];
    for (const series of ['GJ', 'GJ', 'SI', 'GJ', 'SI']) {
      const r = post(books, draft({ series }), ctx);
      books = r.books;
      numbers.push(`${r.journal.series}-${r.journal.number}`);
    }
    expect(numbers).toEqual(['GJ-1', 'GJ-2', 'SI-1', 'GJ-3', 'SI-2']);
  });

  it('a rejected post consumes no number and leaves books untouched (atomic, §6.7)', () => {
    const ctx = testContext();
    const first = post(demoBooks(), draft(), ctx).books;
    expect(errorCode(() => post(first, draft({ date: '2026-09-15' }), ctx))).toBe('PERIOD_CLOSED');
    expect(first.journals).toHaveLength(1);
    const second = post(first, draft(), ctx);
    expect(second.journal.number).toBe(2);
  });

  it('is pure: the input books are not changed', () => {
    const books = demoBooks();
    post(books, draft(), testContext());
    expect(books.journals).toHaveLength(0);
    expect(books.seriesCounters.size).toBe(0);
  });

  it('stamps every line with company, author, timestamp and line number (§6.8)', () => {
    const { journal } = post(demoBooks(), draft(), testContext());
    expect(journal).toMatchObject({ id: 'j-1', companyId: CO, authorId: ALICE, approverId: null, reversalOf: null, postedAt: '2026-10-07T09:00:00.000Z' });
    journal.lines.forEach((l, i) => {
      expect(l).toMatchObject({ lineNo: i + 1, companyId: CO, authorId: ALICE, postedAt: journal.postedAt });
      expect(typeof l.accountId).toBe('string');
    });
  });

  it('balances in transaction and functional currency (§6.1)', () => {
    const { journal } = post(demoBooks(), draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [
        { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
        { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
        { accountId: ACC.cash, side: 'CR', amount: usd('0.02') },
      ],
    }), testContext());
    const total = (side: 'DR' | 'CR', key: 'txnAmount' | 'functionalAmount', c: 'USD' | 'ZMW') =>
      sumMoney(journal.lines.filter((l) => l.side === side).map((l) => l[key]), c);
    expect(total('DR', 'txnAmount', 'USD').equals(total('CR', 'txnAmount', 'USD'))).toBe(true);
    expect(total('DR', 'functionalAmount', 'ZMW').equals(total('CR', 'functionalAmount', 'ZMW'))).toBe(true);
  });

  it('freezes the posted journal and its lines (§6.5)', () => {
    const { journal, books } = post(demoBooks(), draft(), testContext());
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal.lines)).toBe(true);
    expect(Object.isFrozen(journal.lines[0])).toBe(true);
    expect(Object.isFrozen(books.journals)).toBe(true);
    expect(() => {
      (journal as { memo: string }).memo = 'edited';
    }).toThrow(TypeError);
  });
});
