import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { openBooks } from './books';
import { PeriodId } from './ids';
import type { Account, Company } from './model';
import { ACC, CO, demoAccounts, demoPeriods } from './testing/fixtures';

const company: Company = { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding };

describe('openBooks guards (review r1)', () => {
  it('rejects a duplicate account id even when codes differ (I1)', () => {
    const base = demoAccounts()[0] as Account;
    const dupId = { ...base, code: '9999' };
    expect(errorCode(() => openBooks(company, [...demoAccounts(), dupId], demoPeriods()))).toBe('DUPLICATE_ACCOUNT_CODE');
  });

  it('rejects a duplicate period id even when the date ranges do not overlap (I2)', () => {
    const periods = [
      { id: PeriodId('p1'), companyId: CO, start: '2026-01-01', end: '2026-01-31', status: 'OPEN' as const },
      { id: PeriodId('p1'), companyId: CO, start: '2026-02-01', end: '2026-02-28', status: 'OPEN' as const },
    ];
    expect(errorCode(() => openBooks(company, demoAccounts(), periods))).toBe('INVALID_PERIODS');
  });

  it('rejects an inactive rounding account (M3)', () => {
    const accounts = demoAccounts().map((a) => (a.id === ACC.rounding ? { ...a, active: false } : a));
    expect(errorCode(() => openBooks(company, accounts, demoPeriods()))).toBe('NO_ROUNDING_ACCOUNT');
  });

  it('rejects a rounding account with a control type (M3)', () => {
    const accounts = demoAccounts().map((a) => (a.id === ACC.rounding ? { ...a, control: 'AP' as const } : a));
    expect(errorCode(() => openBooks(company, accounts, demoPeriods()))).toBe('NO_ROUNDING_ACCOUNT');
  });
});
