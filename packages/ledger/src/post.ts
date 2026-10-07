import { commit } from './commit';
import type { CompanyBooks, JournalDraft, LedgerContext, PostResult } from './model';
import { prepareLines } from './validate';

/** Validates, converts and commits a draft journal. A new journal has no approver and reverses nothing. */
export function post(books: CompanyBooks, draft: JournalDraft, ctx: LedgerContext): PostResult {
  const lines = prepareLines(books, draft);
  return commit(
    books,
    {
      series: draft.series,
      date: draft.date,
      currency: draft.currency,
      memo: draft.memo,
      authorId: draft.authorId,
      approverId: null,
      reversalOf: null,
    },
    lines,
    ctx,
  );
}
