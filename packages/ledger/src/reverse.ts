import { isIsoDate } from '@zambooks/shared';
import { commit } from './commit';
import { LedgerError } from './errors';
import type { JournalId, UserId } from './ids';
import type { CompanyBooks, LedgerContext, PostResult, PreparedLine } from './model';
import { findOpenPeriod } from './validate';

export interface ReverseRequest {
  readonly journalId: JournalId;
  readonly date: string;
  readonly authorId: UserId;
  /** Second person; must differ from the author (spec §8 segregation of duties). */
  readonly approverId: UserId;
  readonly memo?: string;
}

export function reverse(books: CompanyBooks, req: ReverseRequest, ctx: LedgerContext): PostResult {
  const original = books.journals.find((j) => j.id === req.journalId);
  if (!original) throw new LedgerError('UNKNOWN_JOURNAL', `No journal ${req.journalId}`);
  if (original.companyId !== books.company.id) {
    throw new LedgerError('CROSS_TENANT', `Journal ${original.id} belongs to another company`);
  }
  if (books.reversals.has(original.id) || original.reversalOf !== null) {
    throw new LedgerError('ALREADY_REVERSED', 'Journal is already reversed or is itself a reversal');
  }
  if (!req.authorId) throw new LedgerError('MISSING_AUTHOR', 'Reversal has no author');
  if (!req.approverId || req.approverId === req.authorId) {
    throw new LedgerError('SOD_VIOLATION', 'A reversal needs a second approver');
  }
  if (!isIsoDate(req.date) || req.date < original.date) {
    throw new LedgerError('INVALID_DATE', 'Reversal date must be a real date on or after the original');
  }
  findOpenPeriod(books, req.date);
  const lines: PreparedLine[] = original.lines.map((l) => ({
    accountId: l.accountId,
    side: l.side === 'DR' ? 'CR' : 'DR',
    partyId: l.partyId,
    txnAmount: l.txnAmount,
    rate: l.rate,
    rateSource: l.rateSource,
    rateDate: l.rateDate,
    functionalAmount: l.functionalAmount,
    isRounding: l.isRounding,
  }));
  return commit(
    books,
    {
      series: original.series,
      date: req.date,
      currency: original.currency,
      memo: req.memo ?? `Reversal of ${original.series}-${original.number}`,
      authorId: req.authorId,
      approverId: req.approverId,
      reversalOf: original.id,
    },
    lines,
    ctx,
  );
}
