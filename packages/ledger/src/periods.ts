import { LedgerError } from './errors';
import type { PeriodId } from './ids';
import type { Actor, AuditEvent, CompanyBooks, PeriodStatus } from './model';

export const PERIOD_ADMIN = 'PERIOD_ADMIN';

export interface PeriodChange {
  readonly books: CompanyBooks;
  readonly audit: AuditEvent;
}

function transition(
  books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string,
  from: PeriodStatus, to: PeriodStatus, type: AuditEvent['type'],
): PeriodChange {
  const period = books.periods.find((p) => p.id === periodId);
  if (!period) throw new LedgerError('UNKNOWN_PERIOD', `No period ${periodId}`);
  if (period.status !== from) throw new LedgerError('PERIOD_STATE', `Period ${periodId} is already ${period.status}`);
  if (!reason.trim()) throw new LedgerError('REASON_REQUIRED', 'A reason is required');
  const periods = Object.freeze(books.periods.map((p) => (p.id === periodId ? Object.freeze({ ...p, status: to }) : p)));
  const audit: AuditEvent = Object.freeze({ type, companyId: books.company.id, periodId, actorId: actor.id, reason, at: now });
  return { books: Object.freeze({ ...books, periods }), audit };
}

export function closePeriod(books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange {
  return transition(books, periodId, actor, reason, now, 'OPEN', 'CLOSED', 'PERIOD_CLOSED');
}

export function reopenPeriod(books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange {
  if (!actor.roles.includes(PERIOD_ADMIN)) throw new LedgerError('FORBIDDEN', 'Reopening a period needs PERIOD_ADMIN');
  return transition(books, periodId, actor, reason, now, 'CLOSED', 'OPEN', 'PERIOD_REOPENED');
}
