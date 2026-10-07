import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { JournalId } from './ids';
import type { LedgerContext } from './model';
import { post } from './post';
import { reverse } from './reverse';
import { ALICE, BOB, demoBooks, draft, testContext } from './testing/fixtures';

/** A context that always hands out the same journal id. */
const fixedId = (id: string): LedgerContext => ({ now: () => '2026-10-08T09:00:00.000Z', newJournalId: () => JournalId(id) });

describe('commit rejects a journal id already in the books', () => {
  it('rejects a post whose context reissues an existing id, and the rejection consumes no number', () => {
    const first = post(demoBooks(), draft(), testContext());
    const books = first.books;
    expect(errorCode(() => post(books, draft(), fixedId(first.journal.id)))).toBe('DUPLICATE_JOURNAL_ID');
    expect(books.journals).toHaveLength(1);
    expect(books.seriesCounters.get('GJ')).toBe(1);

    const next = post(books, draft(), fixedId('j-unique'));
    expect(next.journal.number).toBe(2);
    expect(next.books.journals.map((j) => j.id)).toEqual([first.journal.id, JournalId('j-unique')]);
  });

  it('rejects a reversal whose context reissues an existing id, and the rejection consumes no number', () => {
    const first = post(demoBooks(), draft(), testContext());
    const books = first.books;
    const req = { journalId: first.journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB };
    expect(errorCode(() => reverse(books, req, fixedId(first.journal.id)))).toBe('DUPLICATE_JOURNAL_ID');
    expect(books.journals).toHaveLength(1);
    expect(books.reversals.has(first.journal.id)).toBe(false);

    const r = reverse(books, req, fixedId('j-rev'));
    expect(r.journal.number).toBe(2);
    expect(r.books.reversals.get(first.journal.id)).toBe(JournalId('j-rev'));
  });
});
