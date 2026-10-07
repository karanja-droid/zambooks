import { describe, expect, it } from 'vitest';
import type { CompanyBooks } from './model';
import { post } from './post';
import { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { reverse } from './reverse';
import { ACC, ALICE, BOB, PARTY, draft, demoBooks, testContext, zmw } from './testing/fixtures';

function scenario(): CompanyBooks {
  const ctx = testContext();
  let b = demoBooks();
  const steps = [
    draft({ date: '2026-10-01', lines: [{ accountId: ACC.cash, side: 'DR', amount: zmw('10000.00') }, { accountId: ACC.capital, side: 'CR', amount: zmw('10000.00') }] }),
    draft({ date: '2026-10-05', series: 'SI', lines: [{ accountId: ACC.ar, side: 'DR', amount: zmw('1160.00'), partyId: PARTY.customer }, { accountId: ACC.sales, side: 'CR', amount: zmw('1160.00') }] }),
    draft({ date: '2026-10-06', series: 'PI', lines: [{ accountId: ACC.expenses, side: 'DR', amount: zmw('300.00') }, { accountId: ACC.ap, side: 'CR', amount: zmw('300.00'), partyId: PARTY.supplier }] }),
    draft({ date: '2026-10-20', series: 'RC', lines: [{ accountId: ACC.cash, side: 'DR', amount: zmw('1000.00') }, { accountId: ACC.ar, side: 'CR', amount: zmw('1000.00'), partyId: PARTY.customer }] }),
  ];
  for (const d of steps) b = post(b, d, ctx).books;
  return b;
}

describe('reports', () => {
  it('computes signed functional balances as of a date', () => {
    const bal = accountBalances(scenario(), '2026-10-31');
    expect(bal.get(ACC.cash)?.toDecimalString()).toBe('11000.00');
    expect(bal.get(ACC.ar)?.toDecimalString()).toBe('160.00');
    expect(bal.get(ACC.sales)?.toDecimalString()).toBe('-1160.00');
    expect(accountBalances(scenario(), '2026-10-05').get(ACC.cash)?.toDecimalString()).toBe('10000.00');
  });

  it('trial balance nets to zero and omits zero rows (§6.2)', () => {
    const tb = trialBalance(scenario(), '2026-10-31');
    expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true);
    expect(tb.totalDebit.toDecimalString()).toBe('11460.00');
    expect(tb.rows.map((r) => r.code)).toEqual(['1000', '1200', '2000', '3000', '4000', '5000']);
    expect(tb.rows.find((r) => r.code === '4000')?.credit.toDecimalString()).toBe('1160.00');
    expect(trialBalance(demoBooks(), '2026-10-31').rows).toEqual([]);
  });

  it('balance sheet identity holds including unclosed earnings (§6.3)', () => {
    const bs = balanceSheetCheck(scenario(), '2026-10-31');
    expect(bs.assets.toDecimalString()).toBe('11160.00');
    expect(bs.liabilities.toDecimalString()).toBe('300.00');
    expect(bs.equity.toDecimalString()).toBe('10000.00');
    expect(bs.unclosedEarnings.toDecimalString()).toBe('860.00');
    expect(bs.holds).toBe(true);
  });

  it('AR and AP sub-ledgers reconcile to their control accounts (§6.4)', () => {
    const ar = subledgerBalances(scenario(), '2026-10-31', 'AR');
    expect(ar.byParty.get(PARTY.customer)?.toDecimalString()).toBe('160.00');
    expect(ar.controlTotal.toDecimalString()).toBe('160.00');
    expect(ar.reconciles).toBe(true);
    const ap = subledgerBalances(scenario(), '2026-10-31', 'AP');
    expect(ap.byParty.get(PARTY.supplier)?.toDecimalString()).toBe('-300.00');
    expect(ap.reconciles).toBe(true);
  });

  it('a reversed journal nets its accounts back to zero', () => {
    const ctx = testContext();
    const r = post(demoBooks(), draft(), ctx);
    const rev = reverse(r.books, { journalId: r.journal.id, date: '2026-10-16', authorId: ALICE, approverId: BOB }, ctx);
    expect(trialBalance(rev.books, '2026-10-31').rows).toEqual([]);
  });
});
