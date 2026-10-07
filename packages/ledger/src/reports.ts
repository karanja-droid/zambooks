import { Money, sumMoney } from '@zambooks/shared';
import type { AccountId, PartyId } from './ids';
import type { AccountType, CompanyBooks, PostedLine } from './model';

export interface TrialBalanceRow {
  readonly accountId: AccountId;
  readonly code: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface TrialBalance {
  readonly rows: TrialBalanceRow[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
}

export interface BalanceSheetCheck {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly equity: Money;
  readonly unclosedEarnings: Money;
  readonly holds: boolean;
}

export interface SubledgerBalances {
  readonly byParty: Map<PartyId, Money>;
  readonly controlTotal: Money;
  readonly reconciles: boolean;
}

const signed = (l: PostedLine): Money => (l.side === 'DR' ? l.functionalAmount : l.functionalAmount.negate());

function linesAsOf(books: CompanyBooks, asOf: string): PostedLine[] {
  return books.journals.filter((j) => j.date <= asOf).flatMap((j) => j.lines);
}

export function accountBalances(books: CompanyBooks, asOf: string): Map<AccountId, Money> {
  const zero = Money.zero(books.company.functionalCurrency);
  const out = new Map<AccountId, Money>();
  for (const l of linesAsOf(books, asOf)) out.set(l.accountId, (out.get(l.accountId) ?? zero).add(signed(l)));
  return out;
}

export function trialBalance(books: CompanyBooks, asOf: string): TrialBalance {
  const currency = books.company.functionalCurrency;
  const zero = Money.zero(currency);
  const rows = [...accountBalances(books, asOf)]
    .filter(([, bal]) => !bal.isZero())
    .map(([accountId, bal]) => ({
      accountId,
      /* v8 ignore next -- accountId always keys an existing account; openBooks guarantees every posted line's account is in books.accounts. */
      code: books.accounts.get(accountId)?.code ?? '',
      debit: bal.isPositive() ? bal : zero,
      credit: bal.isNegative() ? bal.negate() : zero,
    }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return {
    rows,
    totalDebit: sumMoney(rows.map((r) => r.debit), currency),
    totalCredit: sumMoney(rows.map((r) => r.credit), currency),
  };
}

export function balanceSheetCheck(books: CompanyBooks, asOf: string): BalanceSheetCheck {
  const currency = books.company.functionalCurrency;
  const balances = accountBalances(books, asOf);
  const total = (...types: AccountType[]) =>
    sumMoney([...balances].filter(([id]) => types.includes(books.accounts.get(id)?.type as AccountType)).map(([, b]) => b), currency);
  const assets = total('ASSET');
  const liabilities = total('LIABILITY').negate();
  const equity = total('EQUITY').negate();
  const unclosedEarnings = total('INCOME', 'EXPENSE').negate();
  return { assets, liabilities, equity, unclosedEarnings, holds: assets.equals(liabilities.add(equity).add(unclosedEarnings)) };
}

export function subledgerBalances(books: CompanyBooks, asOf: string, control: 'AR' | 'AP'): SubledgerBalances {
  const zero = Money.zero(books.company.functionalCurrency);
  const byParty = new Map<PartyId, Money>();
  let controlTotal = zero;
  let partyTotal = zero;
  for (const l of linesAsOf(books, asOf)) {
    if (books.accounts.get(l.accountId)?.control !== control) continue;
    controlTotal = controlTotal.add(signed(l));
    if (l.partyId) {
      byParty.set(l.partyId, (byParty.get(l.partyId) ?? zero).add(signed(l)));
      partyTotal = partyTotal.add(signed(l));
    }
  }
  return { byParty, controlTotal, reconciles: controlTotal.equals(partyTotal) };
}
