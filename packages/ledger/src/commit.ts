import { convert, isIsoDate, type CurrencyCode } from '@zambooks/shared';
import { LedgerError } from './errors';
import type { JournalId, UserId } from './ids';
import type { CompanyBooks, LedgerContext, PostedJournal, PostedLine, PostResult, PreparedLine } from './model';
import { findOpenPeriod, isUsableRate, netDebit, requireAccount, requireAuthor, requireParty } from './validate';

const ISO_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** True only for a full ISO-8601 timestamp (date, time and offset) on a real calendar date. */
function isIsoTimestamp(s: string): boolean {
  const m = ISO_TIMESTAMP.exec(s);
  return m !== null && isIsoDate(m[1] as string);
}

export interface JournalHeader {
  readonly series: string;
  readonly date: string;
  readonly currency: CurrencyCode;
  readonly memo: string;
  readonly authorId: UserId;
  readonly approverId: UserId | null;
  readonly reversalOf: JournalId | null;
}

/**
 * Re-checks every prepared line against the books before anything is numbered.
 * `commit` is the single write path (post and reverse both go through it), so it
 * enforces the §6 line invariants itself instead of trusting its caller.
 */
function checkLines(books: CompanyBooks, header: JournalHeader, lines: readonly PreparedLine[]): void {
  const { company } = books;
  const functional = company.functionalCurrency;
  if (lines.length < 2) throw new LedgerError('EMPTY_JOURNAL', 'A journal needs at least two lines');

  let roundingLines = 0;
  lines.forEach((l, i) => {
    const n = i + 1;
    const account = requireAccount(books, l.accountId);
    requireParty(account, l.partyId);
    if (l.txnAmount.currency !== header.currency || l.functionalAmount.currency !== functional) {
      throw new LedgerError(
        'CURRENCY_MISMATCH',
        `Line ${n} must be ${header.currency} with a ${functional} functional amount`,
      );
    }
    // §6.9: the stored rate, source and date must be complete and must reproduce the functional amount.
    const rate = { from: header.currency, to: functional, rate: l.rate, source: l.rateSource, rateDate: l.rateDate };
    const identityOk = header.currency !== functional || l.rate === '1';
    if (!identityOk || !isUsableRate(rate, header.currency, functional, header.date)) {
      throw new LedgerError('BAD_FX_RATE', `Line ${n} carries an incomplete or invalid FX rate`);
    }
    if (l.isRounding) {
      // §6.10: a rounding line sits on the designated account, moves no transaction-currency value
      // and carries a strictly positive functional difference.
      roundingLines += 1;
      if (l.accountId !== company.roundingAccountId) {
        throw new LedgerError('NO_ROUNDING_ACCOUNT', `Rounding line ${n} is not on the company rounding account`);
      }
      if (!l.txnAmount.isZero() || !l.functionalAmount.isPositive()) {
        throw new LedgerError('NON_POSITIVE_AMOUNT', `Rounding line ${n} must have a zero transaction amount and a positive functional amount`);
      }
      return;
    }
    if (!l.txnAmount.isPositive()) throw new LedgerError('NON_POSITIVE_AMOUNT', `Line ${n} amount must be positive`);
    if (!convert(l.txnAmount, rate).equals(l.functionalAmount)) {
      throw new LedgerError('BAD_FX_RATE', `Line ${n} functional amount does not equal its transaction amount at the stored rate`);
    }
  });

  if (!netDebit(lines, (l) => l.txnAmount, header.currency).isZero()) {
    throw new LedgerError('UNBALANCED', `Journal does not balance in ${header.currency}`);
  }
  if (!netDebit(lines, (l) => l.functionalAmount, functional).isZero()) {
    throw new LedgerError('UNBALANCED', `Journal does not balance in ${functional}`);
  }
  // Every non-rounding functional amount was just proven to be convert(txnAmount), and the transaction
  // amounts balance, so the functional imbalance a single rounding line can close is structurally at most
  // (lines - 1)/2 minor units. More than one rounding line is never produced and is rejected.
  if (roundingLines > 1) throw new LedgerError('UNBALANCED', 'A journal carries at most one rounding line');
}

function checkHeader(books: CompanyBooks, header: JournalHeader): void {
  requireAuthor(header.authorId);
  if (header.approverId !== null && (header.approverId.trim() === '' || header.approverId === header.authorId)) {
    throw new LedgerError('SOD_VIOLATION', 'The approver must be a named person other than the author');
  }
  findOpenPeriod(books, header.date);
  if (header.reversalOf !== null) {
    const original = books.journals.find((j) => j.id === header.reversalOf);
    if (!original) throw new LedgerError('UNKNOWN_JOURNAL', `No journal ${header.reversalOf}`);
    if (books.reversals.has(original.id) || original.reversalOf !== null) {
      throw new LedgerError('ALREADY_REVERSED', `Journal ${original.id} is already reversed or is itself a reversal`);
    }
  }
}

/**
 * Numbers, stamps and appends one journal. Pure and atomic: every check on the books,
 * header and lines runs before the context is asked for an id or a timestamp. The one
 * check that must follow is that the issued id is not already in the books; it runs
 * before anything is numbered, stamped or appended. Either way a rejection leaves no
 * trace (the series number is derived from the unchanged books, so none is consumed),
 * and the input books are never mutated. The result, the new books and every journal and line
 * are frozen; the Maps are fresh copies (a Map cannot be frozen), so no Map is shared with the input.
 */
export function commit(
  books: CompanyBooks,
  header: JournalHeader,
  lines: readonly PreparedLine[],
  ctx: LedgerContext,
): PostResult {
  checkHeader(books, header);
  checkLines(books, header, lines);

  const { company } = books;
  // §6.7: gapless per company (these books) and per series; only a successful commit takes a number.
  const number = (books.seriesCounters.get(header.series) ?? 0) + 1;
  const id = ctx.newJournalId();
  if (books.journals.some((j) => j.id === id)) {
    throw new LedgerError('DUPLICATE_JOURNAL_ID', `Journal id ${id} is already in the books`);
  }
  const postedAt = ctx.now();
  // §6.8: every line records when it was posted; the context's clock is checked like any other input.
  if (!isIsoTimestamp(postedAt)) {
    throw new LedgerError('INVALID_TIMESTAMP', `Context timestamp ${JSON.stringify(postedAt)} is not ISO-8601`);
  }

  const postedLines: readonly PostedLine[] = Object.freeze(
    lines.map((l, i) =>
      Object.freeze({
        lineNo: i + 1,
        companyId: company.id,
        accountId: l.accountId,
        side: l.side,
        partyId: l.partyId,
        txnAmount: l.txnAmount,
        rate: l.rate,
        rateSource: l.rateSource,
        rateDate: l.rateDate,
        functionalAmount: l.functionalAmount,
        isRounding: l.isRounding,
        authorId: header.authorId,
        postedAt,
      }),
    ),
  );

  const journal: PostedJournal = Object.freeze({
    id,
    companyId: company.id,
    series: header.series,
    number,
    date: header.date,
    currency: header.currency,
    memo: header.memo,
    authorId: header.authorId,
    approverId: header.approverId,
    postedAt,
    reversalOf: header.reversalOf,
    lines: postedLines,
  });

  const reversals = new Map(books.reversals);
  if (header.reversalOf !== null) reversals.set(header.reversalOf, id);

  const next: CompanyBooks = Object.freeze({
    company: books.company,
    accounts: new Map(books.accounts),
    periods: books.periods,
    journals: Object.freeze([...books.journals, journal]),
    seriesCounters: new Map(books.seriesCounters).set(header.series, number),
    reversals,
  });
  return Object.freeze({ books: next, journal });
}
