import { Money, type FxRate } from '@zambooks/shared';
import { openBooks } from '../books';
import { AccountId, CompanyId, JournalId, PartyId, PeriodId, UserId } from '../ids';
import type { Account, AccountType, CompanyBooks, ControlKind, JournalDraft, LedgerContext, Period } from '../model';

export const CO = CompanyId('co-1');
export const OTHER_CO = CompanyId('co-2');
export const ALICE = UserId('u-alice');
export const BOB = UserId('u-bob');
export const CAROL = UserId('u-carol');
export const PARTY = { customer: PartyId('p-cust-1'), supplier: PartyId('p-supp-1') } as const;

export const ACC = {
  cash: AccountId('a-1000'),
  ar: AccountId('a-1200'),
  inventory: AccountId('a-1300'),
  dormant: AccountId('a-1999'),
  ap: AccountId('a-2000'),
  capital: AccountId('a-3000'),
  sales: AccountId('a-4000'),
  expenses: AccountId('a-5000'),
  rounding: AccountId('a-8999'),
} as const;

export const PERIOD = {
  sep: PeriodId('per-2026-09'),
  oct: PeriodId('per-2026-10'),
  nov: PeriodId('per-2026-11'),
} as const;

const acct = (
  id: AccountId, code: string, name: string, type: AccountType,
  control: ControlKind | null = null, active = true,
): Account => ({ id, companyId: CO, code, name, type, control, active });

export function demoAccounts(): Account[] {
  return [
    acct(ACC.cash, '1000', 'Cash at bank', 'ASSET'),
    acct(ACC.ar, '1200', 'Trade receivables', 'ASSET', 'AR'),
    acct(ACC.inventory, '1300', 'Inventory', 'ASSET', 'INVENTORY'),
    acct(ACC.dormant, '1999', 'Dormant suspense', 'ASSET', null, false),
    acct(ACC.ap, '2000', 'Trade payables', 'LIABILITY', 'AP'),
    acct(ACC.capital, '3000', 'Share capital', 'EQUITY'),
    acct(ACC.sales, '4000', 'Sales', 'INCOME'),
    acct(ACC.expenses, '5000', 'Operating expenses', 'EXPENSE'),
    acct(ACC.rounding, '8999', 'FX rounding differences', 'EXPENSE'),
  ];
}

export function demoPeriods(): Period[] {
  return [
    { id: PERIOD.sep, companyId: CO, start: '2026-09-01', end: '2026-09-30', status: 'CLOSED' },
    { id: PERIOD.oct, companyId: CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' },
    { id: PERIOD.nov, companyId: CO, start: '2026-11-01', end: '2026-11-30', status: 'OPEN' },
  ];
}

export function demoBooks(): CompanyBooks {
  return openBooks(
    { id: CO, name: 'Demo Retail Ltd', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding },
    demoAccounts(),
    demoPeriods(),
  );
}

export function testContext(): LedgerContext {
  let n = 0;
  return { now: () => '2026-10-07T09:00:00.000Z', newJournalId: () => JournalId(`j-${++n}`) };
}

export const zmw = (s: string) => Money.parse(s, 'ZMW');
export const usd = (s: string) => Money.parse(s, 'USD');
export const usdZmw = (rate: string, rateDate = '2026-10-01'): FxRate => ({
  from: 'USD', to: 'ZMW', rate, source: 'BOZ', rateDate,
});

export function draft(overrides: Partial<JournalDraft> = {}): JournalDraft {
  return {
    companyId: CO,
    series: 'GJ',
    date: '2026-10-15',
    currency: 'ZMW',
    memo: 'test journal',
    authorId: ALICE,
    lines: [
      { accountId: ACC.cash, side: 'DR', amount: zmw('100.00') },
      { accountId: ACC.capital, side: 'CR', amount: zmw('100.00') },
    ],
    ...overrides,
  };
}
