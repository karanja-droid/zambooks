import { errorCode, type FxRate } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import type { AccountId } from './ids';
import { post } from './post';
import { ACC, draft, demoBooks, testContext, usd, usdZmw } from './testing/fixtures';
import { prepareLines } from './validate';

const books = demoBooks();

const line = (accountId: AccountId, side: 'DR' | 'CR') => ({ accountId, side, amount: usd('1.00') });

const usdJournal = (fxRate: FxRate) => draft({
  currency: 'USD',
  fxRate,
  lines: [line(ACC.cash, 'DR'), line(ACC.capital, 'CR')],
});

const badRates: Array<[string, FxRate]> = [
  ['empty source', { ...usdZmw('26'), source: '' }],
  ['whitespace-only source', { ...usdZmw('26'), source: '   ' }],
  ['impossible rateDate', usdZmw('26', '2026-02-30')],
  ['non-ISO rateDate', usdZmw('26', '2026-10-1')],
  ['rate into a non-functional currency', { ...usdZmw('26'), from: 'USD', to: 'ZAR' }],
];

describe('prepareLines: FX rate guards (§6.9, review T3 M3)', () => {
  it.each(badRates)('rejects a rate with %s as BAD_FX_RATE', (_name, fxRate) => {
    expect(errorCode(() => prepareLines(books, usdJournal(fxRate)))).toBe('BAD_FX_RATE');
  });

  it('accepts the same journal with a valid rate (positive control)', () => {
    const lines = prepareLines(books, usdJournal(usdZmw('26')));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.functionalAmount.toDecimalString()).toBe('26.00');
      expect(l).toMatchObject({ rate: '26', rateSource: 'BOZ', rateDate: '2026-10-01' });
    }
    expect(() => post(books, usdJournal(usdZmw('26')), testContext())).not.toThrow();
  });
});
