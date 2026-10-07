import { describe, expect, it } from 'vitest';
import { AccountId, JournalId } from './ids';
import type { Account, CompanyBooks, PostedJournal, PostedLine } from './model';
import { post } from './post';
import { accountBalances, subledgerBalances, trialBalance } from './reports';
import { ACC, CO, ALICE, PARTY, draft, demoBooks, testContext, zmw } from './testing/fixtures';

/** Replicated from reports.test.ts (author may not edit that file). */
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

/** Bypasses requireParty by hand-building a posted journal, rather than going through post(). */
function booksWithOrphanArLine(): CompanyBooks {
  const base = demoBooks();
  const orphanLine: PostedLine = {
    accountId: ACC.ar,
    side: 'DR',
    partyId: null,
    txnAmount: zmw('500.00'),
    rate: '1',
    rateSource: 'TEST',
    rateDate: '2026-10-10',
    functionalAmount: zmw('500.00'),
    isRounding: false,
    lineNo: 1,
    companyId: CO,
    authorId: ALICE,
    postedAt: '2026-10-10T00:00:00.000Z',
  };
  const journal: PostedJournal = {
    id: JournalId('j-orphan-1'),
    companyId: CO,
    series: 'GJ',
    number: 999,
    date: '2026-10-10',
    currency: 'ZMW',
    memo: 'hand-built: AR control line with no party',
    authorId: ALICE,
    approverId: null,
    postedAt: '2026-10-10T00:00:00.000Z',
    reversalOf: null,
    lines: [orphanLine],
  };
  return { ...base, journals: [journal] };
}

/**
 * Two distinct accounts sharing the same code, bypassing the uniqueness that CoA
 * instantiation conventionally enforces. Exercises the deterministic comparator's
 * tie-break branch at reports.ts, which `localeCompare` never surfaced as a branch.
 */
function booksWithDuplicateCodeAccounts(): CompanyBooks {
  const base = demoBooks();
  const dupAId = AccountId('a-dup-1');
  const dupBId = AccountId('a-dup-2');
  const makeDup = (id: AccountId, name: string): Account => ({
    id,
    companyId: CO,
    code: '9000',
    name,
    type: 'ASSET',
    control: null,
    active: true,
  });
  const accounts = new Map(base.accounts);
  accounts.set(dupAId, makeDup(dupAId, 'Dup A'));
  accounts.set(dupBId, makeDup(dupBId, 'Dup B'));
  const makeLine = (accountId: AccountId, amount: string): PostedLine => ({
    accountId,
    side: 'DR',
    partyId: null,
    txnAmount: zmw(amount),
    rate: '1',
    rateSource: 'TEST',
    rateDate: '2026-10-10',
    functionalAmount: zmw(amount),
    isRounding: false,
    lineNo: 1,
    companyId: CO,
    authorId: ALICE,
    postedAt: '2026-10-10T00:00:00.000Z',
  });
  const journal: PostedJournal = {
    id: JournalId('j-dup-1'),
    companyId: CO,
    series: 'GJ',
    number: 998,
    date: '2026-10-10',
    currency: 'ZMW',
    memo: 'hand-built: two accounts sharing the same code',
    authorId: ALICE,
    approverId: null,
    postedAt: '2026-10-10T00:00:00.000Z',
    reversalOf: null,
    lines: [makeLine(dupAId, '10.00'), makeLine(dupBId, '20.00')],
  };
  return { ...base, accounts, journals: [journal] };
}

describe('reports: reconciliation failure and as-of boundary', () => {
  it('reports reconciles === false when a control line bypasses validation and has no party', () => {
    const result = subledgerBalances(booksWithOrphanArLine(), '2026-10-31', 'AR');
    expect(result.reconciles).toBe(false);
    expect(result.controlTotal.toDecimalString()).toBe('500.00');
    expect(result.byParty.size).toBe(0);
  });

  it('includes the 2026-10-05 journal in the as-of balance for that same date (inclusive boundary)', () => {
    expect(accountBalances(scenario(), '2026-10-05').get(ACC.ar)?.toDecimalString()).toBe('1160.00');
  });

  it('sorts two rows sharing the same code deterministically, without relying on locale collation', () => {
    const dupRows = trialBalance(booksWithDuplicateCodeAccounts(), '2026-10-31').rows.filter((r) => r.code === '9000');
    expect(dupRows).toHaveLength(2);
    expect(dupRows.map((r) => r.debit.toDecimalString()).sort()).toEqual(['10.00', '20.00']);
  });
});
