import { Money, convert, identityRate, isIsoDate, isValidRate, sumMoney, type CurrencyCode, type FxRate } from '@zambooks/shared';
import { LedgerError } from './errors';
import type { AccountId, PartyId } from './ids';
import type { Account, CompanyBooks, JournalDraft, Period, PreparedLine, Side } from './model';

/** A string field that must carry something other than whitespace. */
const isBlank = (s: string | null | undefined): boolean => typeof s !== 'string' || s.trim() === '';

/** §6.8: every journal and line has an author. */
export function requireAuthor(authorId: string | null | undefined): void {
  if (isBlank(authorId)) throw new LedgerError('MISSING_AUTHOR', 'Journal has no author');
}

/**
 * The OPEN period whose inclusive [start, end] range contains `date`.
 * §6.6: a date in a CLOSED period is rejected, never silently moved.
 */
export function findOpenPeriod(books: CompanyBooks, date: string): Period {
  if (!isIsoDate(date)) throw new LedgerError('INVALID_DATE', `Not a real ISO date: ${JSON.stringify(date)}`);
  const period = books.periods.find((p) => p.start <= date && date <= p.end);
  if (!period) throw new LedgerError('NO_PERIOD', `No accounting period contains ${date}`);
  if (period.status !== 'OPEN') throw new LedgerError('PERIOD_CLOSED', `Period ${period.id} is closed`);
  return period;
}

/** §6.8 / §6.12: a line references an account ID that exists in this company's chart. */
export function requireAccount(books: CompanyBooks, accountId: AccountId): Account {
  const account = books.accounts.get(accountId);
  if (!account) throw new LedgerError('UNKNOWN_ACCOUNT', `Unknown account ${accountId}`);
  if (account.companyId !== books.company.id) {
    throw new LedgerError('CROSS_TENANT', `Account ${accountId} belongs to another company`);
  }
  return account;
}

/** §6.4: AR and AP control-account lines must name a party. */
export function requireParty(account: Account, partyId: PartyId | null | undefined): PartyId | null {
  const needsParty = account.control === 'AR' || account.control === 'AP';
  if (needsParty && isBlank(partyId)) {
    throw new LedgerError('MISSING_PARTY', `Line on ${account.control} control account ${account.id} has no party`);
  }
  return isBlank(partyId) ? null : (partyId as PartyId);
}

interface SidedAmount {
  readonly side: Side;
}

/** Debit total minus credit total of the selected amounts, all in `currency`. */
export function netDebit<T extends SidedAmount>(lines: readonly T[], pick: (l: T) => Money, currency: CurrencyCode): Money {
  const total = (side: Side) => sumMoney(lines.filter((l) => l.side === side).map(pick), currency);
  return total('DR').subtract(total('CR'));
}

/** §6.9: an FX rate is usable only if it is complete, well-formed and not dated after the journal. */
export function isUsableRate(rate: FxRate, from: CurrencyCode, to: CurrencyCode, onOrBefore: string): boolean {
  return (
    rate.from === from &&
    rate.to === to &&
    isValidRate(rate.rate) &&
    !isBlank(rate.source) &&
    isIsoDate(rate.rateDate) &&
    rate.rateDate <= onOrBefore
  );
}

function resolveRate(books: CompanyBooks, draft: JournalDraft): FxRate {
  const functional = books.company.functionalCurrency;
  if (draft.currency === functional) {
    if (draft.fxRate !== undefined) {
      throw new LedgerError('BAD_FX_RATE', `A ${functional} journal is already in functional currency and takes no FX rate`);
    }
    return identityRate(functional, draft.date);
  }
  if (draft.fxRate === undefined) {
    throw new LedgerError('MISSING_FX_RATE', `A ${draft.currency} journal needs a ${draft.currency}->${functional} rate`);
  }
  if (!isUsableRate(draft.fxRate, draft.currency, functional, draft.date)) {
    throw new LedgerError(
      'BAD_FX_RATE',
      `Rate must be ${draft.currency}->${functional}, a plain positive decimal, with a source and a real rateDate on or before ${draft.date}`,
    );
  }
  return draft.fxRate;
}

/**
 * Validates a draft against the books and converts every line to functional currency.
 *
 * Each converted line is rounded half-even, so it is off by at most half a minor unit.
 * Any resulting functional imbalance is posted as one explicit line on the company's
 * designated rounding account (§6.10), with a zero transaction amount so the
 * transaction-currency balance (§6.1) is unaffected. Nothing is absorbed silently.
 */
export function prepareLines(books: CompanyBooks, draft: JournalDraft): PreparedLine[] {
  const { company } = books;
  requireAuthor(draft.authorId);
  if (draft.companyId !== company.id) {
    throw new LedgerError('CROSS_TENANT', `Draft for company ${draft.companyId} posted to books of ${company.id}`);
  }
  findOpenPeriod(books, draft.date);
  if (draft.lines.length < 2) throw new LedgerError('EMPTY_JOURNAL', 'A journal needs at least two lines');

  const checked = draft.lines.map((line, i) => {
    const account = requireAccount(books, line.accountId);
    if (!account.active) throw new LedgerError('INACTIVE_ACCOUNT', `Account ${account.id} is inactive`);
    if (line.amount.currency !== draft.currency) {
      throw new LedgerError('CURRENCY_MISMATCH', `Line ${i + 1} is ${line.amount.currency}; journal is ${draft.currency}`);
    }
    if (!line.amount.isPositive()) {
      throw new LedgerError('NON_POSITIVE_AMOUNT', `Line ${i + 1} amount must be positive; use the other side instead`);
    }
    return { line, side: line.side, partyId: requireParty(account, line.partyId) };
  });

  const txnNet = netDebit(checked, (c) => c.line.amount, draft.currency);
  if (!txnNet.isZero()) {
    throw new LedgerError('UNBALANCED', `Debits and credits differ by ${txnNet.toDecimalString()} ${draft.currency}`);
  }

  const rate = resolveRate(books, draft);
  const prepared: PreparedLine[] = checked.map(({ line, partyId }) =>
    Object.freeze({
      accountId: line.accountId,
      side: line.side,
      partyId,
      txnAmount: line.amount,
      rate: rate.rate,
      rateSource: rate.source,
      rateDate: rate.rateDate,
      functionalAmount: convert(line.amount, rate),
      isRounding: false,
    }),
  );

  const functionalNet = netDebit(prepared, (l) => l.functionalAmount, company.functionalCurrency);
  if (!functionalNet.isZero()) {
    prepared.push(
      Object.freeze({
        accountId: company.roundingAccountId,
        side: functionalNet.isNegative() ? 'DR' : 'CR',
        partyId: null,
        txnAmount: Money.zero(draft.currency),
        rate: rate.rate,
        rateSource: rate.source,
        rateDate: rate.rateDate,
        functionalAmount: functionalNet.isNegative() ? functionalNet.negate() : functionalNet,
        isRounding: true,
      }),
    );
  }
  return prepared;
}

