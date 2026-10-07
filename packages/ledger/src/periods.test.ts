import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { PeriodId } from './ids';
import { PERIOD_ADMIN, closePeriod, reopenPeriod } from './periods';
import { post } from './post';
import { ALICE, BOB, CO, PERIOD, draft, demoBooks, testContext } from './testing/fixtures';

const NOW = '2026-11-02T08:00:00.000Z';
const clerk = { id: ALICE, roles: ['ACCOUNTANT'] };
const admin = { id: BOB, roles: [PERIOD_ADMIN] };

describe('closePeriod', () => {
  it('closes an open period, emits an audit event, and blocks posting (§6.6)', () => {
    const { books, audit } = closePeriod(demoBooks(), PERIOD.oct, clerk, 'October month-end', NOW);
    expect(books.periods.find((p) => p.id === PERIOD.oct)?.status).toBe('CLOSED');
    expect(audit).toEqual({ type: 'PERIOD_CLOSED', companyId: CO, periodId: PERIOD.oct, actorId: ALICE, reason: 'October month-end', at: NOW });
    expect(errorCode(() => post(books, draft(), testContext()))).toBe('PERIOD_CLOSED');
  });

  it('does not mutate the input books', () => {
    const before = demoBooks();
    closePeriod(before, PERIOD.oct, clerk, 'x', NOW);
    expect(before.periods.find((p) => p.id === PERIOD.oct)?.status).toBe('OPEN');
  });

  it.each([
    ['unknown period', PeriodId('nope'), 'x', 'UNKNOWN_PERIOD'],
    ['already closed', PERIOD.sep, 'x', 'PERIOD_STATE'],
    ['blank reason', PERIOD.oct, '  ', 'REASON_REQUIRED'],
  ])('rejects %s', (_n, id, reason, code) => {
    expect(errorCode(() => closePeriod(demoBooks(), id, clerk, reason, NOW))).toBe(code);
  });
});

describe('reopenPeriod', () => {
  it('requires the PERIOD_ADMIN role (§6.6)', () => {
    expect(errorCode(() => reopenPeriod(demoBooks(), PERIOD.sep, clerk, 'Late supplier invoice', NOW))).toBe('FORBIDDEN');
  });

  it('reopens with an audit event and allows posting again', () => {
    const { books, audit } = reopenPeriod(demoBooks(), PERIOD.sep, admin, 'Late supplier invoice', NOW);
    expect(audit).toMatchObject({ type: 'PERIOD_REOPENED', periodId: PERIOD.sep, actorId: BOB, reason: 'Late supplier invoice' });
    expect(post(books, draft({ date: '2026-09-15' }), testContext()).journal.date).toBe('2026-09-15');
  });

  it.each([
    ['already open', PERIOD.oct, 'x', 'PERIOD_STATE'],
    ['blank reason', PERIOD.sep, '', 'REASON_REQUIRED'],
  ])('rejects %s', (_n, id, reason, code) => {
    expect(errorCode(() => reopenPeriod(demoBooks(), id, admin, reason, NOW))).toBe(code);
  });
});
