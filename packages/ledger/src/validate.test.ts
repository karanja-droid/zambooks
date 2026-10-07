import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { AccountId, UserId } from './ids';
import type { JournalDraft } from './model';
import { ACC, OTHER_CO, PARTY, draft, demoBooks, usd, usdZmw, zmw } from './testing/fixtures';
import { findOpenPeriod, prepareLines } from './validate';

const books = demoBooks();

describe('findOpenPeriod', () => {
  it('returns the open period containing the date, inclusive of both ends', () => {
    expect(findOpenPeriod(books, '2026-10-01').id).toBe('per-2026-10');
    expect(findOpenPeriod(books, '2026-10-31').id).toBe('per-2026-10');
  });
  it.each([
    ['2026-02-30', 'INVALID_DATE'],
    ['2027-01-05', 'NO_PERIOD'],
    ['2026-09-15', 'PERIOD_CLOSED'],
  ])('%s -> %s', (date, code) => expect(errorCode(() => findOpenPeriod(books, date))).toBe(code));
});

describe('prepareLines: functional-currency journal', () => {
  it('stamps an identity rate and equal functional amounts (§6.9)', () => {
    const lines = prepareLines(books, draft());
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({ rate: '1', rateSource: 'IDENTITY', rateDate: '2026-10-15', isRounding: false });
      expect(l.functionalAmount.equals(l.txnAmount)).toBe(true);
    }
  });

  it('carries the party on control-account lines', () => {
    const lines = prepareLines(books, draft({
      lines: [
        { accountId: ACC.ar, side: 'DR', amount: zmw('50.00'), partyId: PARTY.customer },
        { accountId: ACC.sales, side: 'CR', amount: zmw('50.00') },
      ],
    }));
    expect(lines[0]?.partyId).toBe(PARTY.customer);
    expect(lines[1]?.partyId).toBeNull();
  });
});

const line = (accountId: AccountId, side: 'DR' | 'CR', amount = zmw('10.00')) => ({ accountId, side, amount });

const rejections: Array<[string, Partial<JournalDraft>, string]> = [
  ['no author', { authorId: UserId('') }, 'MISSING_AUTHOR'],
  ['other company (§6.12)', { companyId: OTHER_CO }, 'CROSS_TENANT'],
  ['impossible date', { date: '2026-02-30' }, 'INVALID_DATE'],
  ['no period', { date: '2027-01-05' }, 'NO_PERIOD'],
  ['closed period (§6.6)', { date: '2026-09-15' }, 'PERIOD_CLOSED'],
  ['single line', { lines: [line(ACC.cash, 'DR')] }, 'EMPTY_JOURNAL'],
  ['unknown / foreign account', { lines: [line(AccountId('a-other-co'), 'DR'), line(ACC.capital, 'CR')] }, 'UNKNOWN_ACCOUNT'],
  ['inactive account', { lines: [line(ACC.dormant, 'DR'), line(ACC.capital, 'CR')] }, 'INACTIVE_ACCOUNT'],
  ['line currency differs', { lines: [line(ACC.cash, 'DR', usd('10.00')), line(ACC.capital, 'CR')] }, 'CURRENCY_MISMATCH'],
  ['zero amount', { lines: [line(ACC.cash, 'DR', zmw('0')), line(ACC.capital, 'CR', zmw('0'))] }, 'NON_POSITIVE_AMOUNT'],
  ['negative amount', { lines: [line(ACC.cash, 'DR', zmw('-10.00')), line(ACC.capital, 'CR', zmw('-10.00'))] }, 'NON_POSITIVE_AMOUNT'],
  ['AR line without party (§6.4)', { lines: [line(ACC.ar, 'DR'), line(ACC.sales, 'CR')] }, 'MISSING_PARTY'],
  ['AP line without party (§6.4)', { lines: [line(ACC.expenses, 'DR'), line(ACC.ap, 'CR')] }, 'MISSING_PARTY'],
  ['unbalanced by one ngwee (§6.1)', { lines: [line(ACC.cash, 'DR', zmw('10.01')), line(ACC.capital, 'CR')] }, 'UNBALANCED'],
  ['foreign journal without rate', { currency: 'USD', lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'MISSING_FX_RATE'],
  ['rate supplied for ZMW journal', { fxRate: usdZmw('26') }, 'BAD_FX_RATE'],
  ['rate for wrong pair', { currency: 'USD', fxRate: { ...usdZmw('26'), from: 'ZAR' }, lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['rate dated after journal', { currency: 'USD', fxRate: usdZmw('26', '2026-10-16'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['rate in exponent form', { currency: 'USD', fxRate: usdZmw('2.6e1'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['zero rate', { currency: 'USD', fxRate: usdZmw('0'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
];

describe('prepareLines: rejections', () => {
  it.each(rejections)('%s', (_name, overrides, code) => {
    expect(errorCode(() => prepareLines(books, draft(overrides)))).toBe(code);
  });
});

describe('prepareLines: foreign-currency journal (§6.9, §6.10)', () => {
  it('converts every line and stores rate, source and date', () => {
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('26.4512'),
      lines: [line(ACC.expenses, 'DR', usd('100.00')), line(ACC.cash, 'CR', usd('100.00'))],
    }));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.txnAmount.toDecimalString()).toBe('100.00');
      expect(l.functionalAmount.toDecimalString()).toBe('2645.12');
      expect(l.functionalAmount.currency).toBe('ZMW');
      expect(l).toMatchObject({ rate: '26.4512', rateSource: 'BOZ', rateDate: '2026-10-01' });
    }
  });

  it('posts a functional rounding difference to the rounding account on the debit side', () => {
    // 0.01 USD x 0.5 -> 0.00 (half-even), twice; 0.02 USD x 0.5 -> 0.01. Debits 0.00, credits 0.01.
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [line(ACC.expenses, 'DR', usd('0.01')), line(ACC.expenses, 'DR', usd('0.01')), line(ACC.cash, 'CR', usd('0.02'))],
    }));
    const rounding = lines.at(-1);
    expect(lines).toHaveLength(4);
    expect(rounding).toMatchObject({ accountId: ACC.rounding, side: 'DR', isRounding: true, partyId: null });
    expect(rounding?.functionalAmount.toDecimalString()).toBe('0.01');
    expect(rounding?.txnAmount.isZero()).toBe(true);
    expect(rounding?.txnAmount.currency).toBe('USD');
  });

  it('posts a rounding difference on the credit side when debits exceed credits', () => {
    // 0.03 USD x 0.5 -> 0.02, twice = 0.04; 0.06 USD x 0.5 -> 0.03.
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [line(ACC.expenses, 'DR', usd('0.03')), line(ACC.expenses, 'DR', usd('0.03')), line(ACC.cash, 'CR', usd('0.06'))],
    }));
    expect(lines.at(-1)).toMatchObject({ accountId: ACC.rounding, side: 'CR', isRounding: true });
    expect(lines.at(-1)?.functionalAmount.toDecimalString()).toBe('0.01');
  });
});
