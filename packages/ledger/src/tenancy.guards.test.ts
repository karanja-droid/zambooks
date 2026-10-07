import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { commit } from './commit';
import type { CompanyBooks } from './model';
import { post } from './post';
import { reverse } from './reverse';
import { ALICE, BOB, OTHER_CO, PERIOD, demoBooks, draft, testContext } from './testing/fixtures';
import { findOpenPeriod } from './validate';

// Security review L7 (§6.12): do not trust that CompanyBooks was built by openBooks.
describe('tenancy guards on hand-built books', () => {
  it('findOpenPeriod rejects a period that belongs to another company', () => {
    const base = demoBooks();
    const books: CompanyBooks = {
      ...base,
      periods: base.periods.map((p) => (p.id === PERIOD.oct ? { ...p, companyId: OTHER_CO } : p)),
    };
    expect(errorCode(() => findOpenPeriod(books, '2026-10-15'))).toBe('CROSS_TENANT');
    expect(errorCode(() => post(books, draft(), testContext()))).toBe('CROSS_TENANT');
  });

  const foreignOriginal = () => {
    const { books, journal } = post(demoBooks(), draft(), testContext());
    const foreign = { ...journal, companyId: OTHER_CO };
    return { books: { ...books, journals: [foreign] } as CompanyBooks, journal: foreign };
  };

  it('reverse rejects an original journal from another company', () => {
    const { books, journal } = foreignOriginal();
    const req = { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB };
    expect(errorCode(() => reverse(books, req, testContext()))).toBe('CROSS_TENANT');
  });

  it('commit rejects a reversal header that points at another company\'s journal', () => {
    const { books, journal } = foreignOriginal();
    const header = {
      series: 'GJ', date: '2026-10-20', currency: journal.currency, memo: 'm',
      authorId: ALICE, approverId: BOB, reversalOf: journal.id,
    };
    const lines = journal.lines.map((l) => ({ ...l, side: l.side === 'DR' ? ('CR' as const) : ('DR' as const) }));
    expect(errorCode(() => commit(books, header, lines, testContext()))).toBe('CROSS_TENANT');
  });
});
