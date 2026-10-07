import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { JournalId } from './ids';
import type { LedgerContext } from './model';
import { post } from './post';
import { demoBooks, draft } from './testing/fixtures';

// Final review L1 (§6.8): the posting timestamp comes from ctx.now() and must be a real ISO-8601 timestamp.
const ctxAt = (now: string, issued: string[] = []): LedgerContext => ({
  now: () => now,
  newJournalId: () => {
    const id = JournalId(`j-${issued.length + 1}`);
    issued.push(id);
    return id;
  },
});

describe('commit rejects a context timestamp that is not ISO-8601', () => {
  it.each(['', '  ', 'now', '2026-10-07', '2026-10-07 09:00:00Z', '2026-10-07T09:00:00', '2026-02-30T09:00:00Z', '2026-10-07T24:00:00Z'])(
    'rejects %j before anything is numbered',
    (now) => {
      const books = demoBooks();
      expect(errorCode(() => post(books, draft(), ctxAt(now)))).toBe('INVALID_TIMESTAMP');
      expect(books.journals).toHaveLength(0);
      expect(books.seriesCounters.get('GJ')).toBeUndefined();
    },
  );

  it.each(['2026-10-07T09:00:00Z', '2026-10-07T09:00:00.123Z', '2026-10-07T11:00:00+02:00'])('accepts %s', (now) => {
    expect(post(demoBooks(), draft(), ctxAt(now)).journal.postedAt).toBe(now);
  });
});
