import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { openBooks } from './books';
import { AccountId, PeriodId } from './ids';
import type { Account, Company } from './model';
import { ACC, CO, OTHER_CO, demoAccounts, demoBooks, demoPeriods } from './testing/fixtures';

const company: Company = { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding };

describe('openBooks', () => {
  it('opens empty books with indexed accounts', () => {
    const books = demoBooks();
    expect(books.accounts.get(ACC.cash)?.code).toBe('1000');
    expect(books.journals).toEqual([]);
    expect(books.seriesCounters.size).toBe(0);
    expect(Object.isFrozen(books)).toBe(true);
  });

  it('rejects an account from another company (§6.12)', () => {
    const foreign = { ...(demoAccounts()[0] as Account), id: AccountId('x'), code: '9000', companyId: OTHER_CO };
    expect(errorCode(() => openBooks(company, [...demoAccounts(), foreign], demoPeriods()))).toBe('CROSS_TENANT');
  });

  it('rejects duplicate account codes', () => {
    const dup = { ...(demoAccounts()[0] as Account), id: AccountId('x') };
    expect(errorCode(() => openBooks(company, [...demoAccounts(), dup], demoPeriods()))).toBe('DUPLICATE_ACCOUNT_CODE');
  });

  it('requires the rounding account to exist (§6.10)', () => {
    const accounts = demoAccounts().filter((a) => a.id !== ACC.rounding);
    expect(errorCode(() => openBooks(company, accounts, demoPeriods()))).toBe('NO_ROUNDING_ACCOUNT');
  });

  it.each([
    ['overlapping', [
      { id: PeriodId('p1'), companyId: CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' as const },
      { id: PeriodId('p2'), companyId: CO, start: '2026-10-31', end: '2026-11-30', status: 'OPEN' as const },
    ]],
    ['inverted', [{ id: PeriodId('p1'), companyId: CO, start: '2026-10-31', end: '2026-10-01', status: 'OPEN' as const }]],
    ['bad date', [{ id: PeriodId('p1'), companyId: CO, start: '2026-02-30', end: '2026-03-31', status: 'OPEN' as const }]],
    ['foreign', [{ id: PeriodId('p1'), companyId: OTHER_CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' as const }]],
  ])('rejects %s periods', (_name, periods) => {
    expect(errorCode(() => openBooks(company, demoAccounts(), periods))).toBe('INVALID_PERIODS');
  });
});
