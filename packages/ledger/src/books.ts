import { isIsoDate } from '@zambooks/shared';
import { LedgerError } from './errors';
import type { AccountId, PeriodId } from './ids';
import type { Account, Company, CompanyBooks, Period } from './model';

export function openBooks(company: Company, accounts: readonly Account[], periods: readonly Period[]): CompanyBooks {
  const byId = new Map<AccountId, Account>();
  const codes = new Set<string>();
  for (const a of accounts) {
    if (a.companyId !== company.id) throw new LedgerError('CROSS_TENANT', `Account ${a.id} belongs to another company`);
    if (byId.has(a.id)) throw new LedgerError('DUPLICATE_ACCOUNT_CODE', `Duplicate account id ${a.id}`);
    if (codes.has(a.code)) throw new LedgerError('DUPLICATE_ACCOUNT_CODE', `Duplicate account code ${a.code}`);
    codes.add(a.code);
    byId.set(a.id, Object.freeze({ ...a }));
  }
  const roundingAccount = byId.get(company.roundingAccountId);
  if (!roundingAccount) {
    throw new LedgerError('NO_ROUNDING_ACCOUNT', 'Company rounding account is not in its chart of accounts');
  }
  if (!roundingAccount.active || roundingAccount.control !== null) {
    throw new LedgerError('NO_ROUNDING_ACCOUNT', 'Company rounding account must be active and have no control type');
  }
  const seenPeriodIds = new Set<PeriodId>();
  const sorted = [...periods].sort((x, y) => x.start.localeCompare(y.start));
  sorted.forEach((p, i) => {
    if (seenPeriodIds.has(p.id)) throw new LedgerError('INVALID_PERIODS', `Duplicate period id ${p.id}`);
    seenPeriodIds.add(p.id);
    const prev = sorted[i - 1];
    const valid =
      p.companyId === company.id && isIsoDate(p.start) && isIsoDate(p.end) && p.start <= p.end &&
      (prev === undefined || prev.end < p.start);
    if (!valid) throw new LedgerError('INVALID_PERIODS', `Period ${p.id} is invalid or overlaps another`);
  });
  return Object.freeze({
    company: Object.freeze({ ...company }),
    accounts: byId,
    periods: Object.freeze(sorted.map((p) => Object.freeze({ ...p }))),
    journals: Object.freeze([]),
    seriesCounters: new Map(),
    reversals: new Map(),
  });
}
