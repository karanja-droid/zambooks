import { describe, expect, it } from 'vitest';
import { PERIOD_ADMIN, closePeriod, reopenPeriod } from './periods';
import { post } from './post';
import { ALICE, BOB, PERIOD, demoBooks, draft, testContext } from './testing/fixtures';

// Final review L2: period transitions return frozen values that share no Map with their input.
const NOW = '2026-11-02T08:00:00.000Z';
const admin = { id: BOB, roles: [PERIOD_ADMIN] };

describe('period transitions freeze their result and copy the Maps', () => {
  const books = post(demoBooks(), draft(), testContext()).books;
  const changes = {
    closePeriod: closePeriod(books, PERIOD.oct, { id: ALICE, roles: [] }, 'month-end', NOW),
    reopenPeriod: reopenPeriod(books, PERIOD.sep, admin, 'late invoice', NOW),
  };
  for (const [name, change] of Object.entries(changes)) {
    it(`${name} returns a frozen change and frozen books`, () => {
      expect(Object.isFrozen(change)).toBe(true);
      expect(Object.isFrozen(change.books)).toBe(true);
      expect(Object.isFrozen(change.audit)).toBe(true);
    });

    it(`${name} shares no Map with the input books`, () => {
      expect(change.books.accounts).not.toBe(books.accounts);
      expect(change.books.seriesCounters).not.toBe(books.seriesCounters);
      expect(change.books.reversals).not.toBe(books.reversals);
      expect([...change.books.accounts]).toEqual([...books.accounts]);
      expect([...change.books.seriesCounters]).toEqual([...books.seriesCounters]);
      expect([...change.books.reversals]).toEqual([...books.reversals]);
    });
  }
});
