import { Money, errorCode, sumMoney } from '@zambooks/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UserId, type JournalId, type PeriodId } from './ids';
import type { CompanyBooks, JournalDraft, PostedJournal } from './model';
import { PERIOD_ADMIN, closePeriod, reopenPeriod } from './periods';
import { post } from './post';
import { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { reverse } from './reverse';
import { journalDraftArb, postAll, roundingDraftArb } from './testing/arbitraries';
import { ACC, ALICE, BOB, CAROL, CO, OTHER_CO, PERIOD, testContext } from './testing/fixtures';

const RUNS = { numRuns: 2000 };
/** 2,000 runs of whole-ledger properties take several seconds; vitest's 5 s default is too short. */
const SLOW = { timeout: 300_000 };
const journalsArb = fc.array(journalDraftArb, { minLength: 1, maxLength: 25 });

function balancedIn(j: PostedJournal): boolean {
  const t = (side: 'DR' | 'CR', key: 'txnAmount' | 'functionalAmount', c: PostedJournal['currency']) =>
    sumMoney(j.lines.filter((l) => l.side === side).map((l) => l[key]), c);
  return t('DR', 'txnAmount', j.currency).equals(t('CR', 'txnAmount', j.currency)) &&
    t('DR', 'functionalAmount', 'ZMW').equals(t('CR', 'functionalAmount', 'ZMW'));
}

function assertBooksInvariants(books: CompanyBooks): void {
  const tb = trialBalance(books, '2026-12-31');
  expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true); // §6.2
  expect(balanceSheetCheck(books, '2026-12-31').holds).toBe(true); // §6.3
  expect(subledgerBalances(books, '2026-12-31', 'AR').reconciles).toBe(true); // §6.4
  expect(subledgerBalances(books, '2026-12-31', 'AP').reconciles).toBe(true); // §6.4
  for (const [series, last] of books.seriesCounters) { // §6.7 gapless
    const numbers = books.journals.filter((j) => j.series === series).map((j) => j.number);
    expect(numbers).toEqual(Array.from({ length: last }, (_, i) => i + 1));
  }
}

describe('§6 ledger invariants (property-based)', SLOW, () => {
  it('posted journals balance, are fully stamped, and books stay consistent (§6.1, 2, 3, 4, 7, 8, 9, 10)', () => {
    fc.assert(fc.property(journalsArb, (drafts) => {
      const { books, journals } = postAll(drafts);
      for (const j of journals) {
        expect(balancedIn(j)).toBe(true);
        const roundingLines = j.lines.filter((l) => l.isRounding);
        expect(roundingLines.length).toBeLessThanOrEqual(1);
        for (const l of j.lines) {
          expect(l.companyId).toBe(CO);
          expect(l.authorId).toBeTruthy();
          expect(l.postedAt).toBeTruthy();
          expect(books.accounts.has(l.accountId)).toBe(true);
          expect(l.rate && l.rateSource && l.rateDate).toBeTruthy();
          expect(l.functionalAmount.currency).toBe('ZMW');
        }
        for (const r of roundingLines) {
          expect(r.accountId).toBe(ACC.rounding);
          expect(r.txnAmount.isZero()).toBe(true);
          expect(r.functionalAmount.minor * 2n).toBeLessThanOrEqual(BigInt(j.lines.length - 1));
        }
      }
      assertBooksInvariants(books);
    }), RUNS);
  });

  it('reversing any subset keeps every invariant, and reversing all zeroes the TB (§6.5)', () => {
    fc.assert(fc.property(journalsArb, fc.array(fc.boolean(), { maxLength: 25 }), (drafts, picks) => {
      const ctx = testContext();
      let { books } = postAll(drafts, ctx);
      const originals = [...books.journals];
      const before = JSON.stringify(originals, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      originals.forEach((j, i) => {
        if (picks[i] ?? true) books = reverse(books, { journalId: j.id, date: '2026-10-31', authorId: ALICE, approverId: BOB }, ctx).books;
      });
      expect(JSON.stringify(books.journals.slice(0, originals.length), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
      assertBooksInvariants(books);
      if (originals.every((_, i) => picks[i] ?? true)) expect(trialBalance(books, '2026-12-31').rows).toEqual([]);
    }), RUNS);
  });

  it('closed periods reject every posting and leave books unchanged (§6.6)', () => {
    fc.assert(fc.property(journalDraftArb, fc.integer({ min: 1, max: 30 }), (d, day) => {
      const { books } = postAll([]);
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      expect(errorCode(() => post(books, { ...d, date, fxRate: d.fxRate && { ...d.fxRate, rateDate: date } }, testContext()))).toBe('PERIOD_CLOSED');
      expect(books.journals).toHaveLength(0);
    }), RUNS);
  });

  it('cross-tenant postings are impossible (§6.12, domain level)', () => {
    fc.assert(fc.property(journalDraftArb, (d) => {
      const { books } = postAll([]);
      expect(errorCode(() => post(books, { ...d, companyId: OTHER_CO }, testContext()))).toBe('CROSS_TENANT');
    }), RUNS);
  });

  it('any one-minor-unit imbalance is rejected (§6.1)', () => {
    fc.assert(fc.property(journalDraftArb, fc.nat(), (d, k) => {
      const i = k % d.lines.length;
      const lines = d.lines.map((l, idx) => (idx === i ? { ...l, amount: l.amount.add(Money.ofMinor(1n, l.amount.currency)) } : l));
      expect(errorCode(() => post(postAll([]).books, { ...d, lines }, testContext()))).toBe('UNBALANCED');
    }), RUNS);
  });
});

/** Deep, order-preserving snapshot of books, including Maps and bigints, for mutation checks. */
const snapshot = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'bigint' ? `${v}n` : v instanceof Map ? { map: [...(v as Map<unknown, unknown>)] } : v);

/** Non-zero account balances as a plain sorted list, for equality checks. */
const nonZeroBalances = (books: CompanyBooks): [string, string][] =>
  [...accountBalances(books, '2026-12-31')]
    .filter(([, b]) => !b.isZero())
    .map(([id, b]): [string, string] => [id, b.minor.toString()])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const ADMIN = { id: CAROL, roles: [PERIOD_ADMIN] } as const;
const CLERK = { id: BOB, roles: [] } as const;
const NOW = '2026-11-02T08:00:00.000Z';

describe('§6 ledger invariants: parked review items (property-based)', SLOW, () => {
  it('reversing into a closed period is rejected; PERIOD_ADMIN reopening then allows it (§6.5, §6.6; T7 M1)', () => {
    fc.assert(fc.property(journalsArb, fc.nat(), fc.boolean(), fc.integer({ min: 0, max: 30 }), (drafts, pick, intoNov, offset) => {
      const ctx = testContext();
      const { books } = postAll(drafts, ctx);
      const target = books.journals[pick % books.journals.length] as PostedJournal;
      const origDay = Number(target.date.slice(8));
      const date = intoNov
        ? `2026-11-${String(1 + (offset % 30)).padStart(2, '0')}`
        : `2026-10-${String(origDay + (offset % (32 - origDay))).padStart(2, '0')}`;
      const periodId = intoNov ? PERIOD.nov : PERIOD.oct;
      const closed = closePeriod(books, periodId, CLERK, 'month end', NOW).books;
      const closedSnap = snapshot(closed);
      const req = { journalId: target.id, date, authorId: ALICE, approverId: BOB };

      expect(errorCode(() => reverse(closed, req, ctx))).toBe('PERIOD_CLOSED');
      expect(snapshot(closed)).toBe(closedSnap);
      expect(errorCode(() => reopenPeriod(closed, periodId, CLERK, 'correction', NOW))).toBe('FORBIDDEN');

      const reopened = reopenPeriod(closed, periodId, ADMIN, 'correction', NOW);
      expect(reopened.audit).toMatchObject({ type: 'PERIOD_REOPENED', periodId, actorId: CAROL, companyId: CO });
      const r = reverse(reopened.books, req, ctx);
      expect(r.journal).toMatchObject({ reversalOf: target.id, date });
      expect(r.books.reversals.get(target.id)).toBe(r.journal.id);
      assertBooksInvariants(r.books);
    }), RUNS);
  });

  it('closePeriod and reopenPeriod never mutate their input; output differs only in that period status (T8 M4)', () => {
    const periodIds = [PERIOD.sep, PERIOD.oct, PERIOD.nov] as const;
    fc.assert(fc.property(
      fc.array(journalDraftArb, { maxLength: 10 }),
      fc.array(fc.record({ period: fc.constantFrom<PeriodId>(...periodIds), admin: fc.boolean(), close: fc.boolean() }), { minLength: 1, maxLength: 8 }),
      (drafts, ops) => {
        let { books } = postAll(drafts);
        for (const op of ops) {
          const before = snapshot(books);
          const status = books.periods.find((p) => p.id === op.period)?.status;
          const actor = op.admin ? ADMIN : CLERK;
          const run = () => (op.close ? closePeriod : reopenPeriod)(books, op.period, actor, 'reason', NOW);
          const legal = op.close ? status === 'OPEN' : status === 'CLOSED' && op.admin;
          if (!legal) {
            expect(errorCode(run)).toBe(op.close ? 'PERIOD_STATE' : op.admin ? 'PERIOD_STATE' : 'FORBIDDEN');
            expect(snapshot(books)).toBe(before);
            continue;
          }
          const { books: next, audit } = run();
          expect(snapshot(books)).toBe(before);
          const to = op.close ? 'CLOSED' : 'OPEN';
          const expected = { ...books, periods: books.periods.map((p) => (p.id === op.period ? { ...p, status: to } : p)) };
          expect(snapshot(next)).toBe(snapshot(expected));
          expect(audit).toMatchObject({ type: op.close ? 'PERIOD_CLOSED' : 'PERIOD_REOPENED', periodId: op.period, actorId: actor.id, at: NOW });
          books = next;
        }
      },
    ), RUNS);
  });

  it('mixed ZMW/USD journals with forced rounding lines keep TB and balance sheet in balance (§6.2, 3, 10; T12 M3)', () => {
    fc.assert(fc.property(
      fc.array(fc.oneof(journalDraftArb, roundingDraftArb), { minLength: 1, maxLength: 25 }),
      roundingDraftArb,
      (drafts, forced) => {
        const { books, journals } = postAll([...drafts, forced]);
        const rounding = journals.flatMap((j) => j.lines.filter((l) => l.isRounding));
        expect(rounding.length).toBeGreaterThanOrEqual(1);
        expect(journals.some((j) => j.currency === 'USD')).toBe(true);
        const tb = trialBalance(books, '2026-12-31');
        expect(tb.totalDebit.currency).toBe('ZMW');
        expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true);
        expect(balanceSheetCheck(books, '2026-12-31').holds).toBe(true);
        // §6.10: every rounding difference is visible on the rounding account, nothing absorbed elsewhere.
        const roundingNet = sumMoney(rounding.map((l) => (l.side === 'DR' ? l.functionalAmount : l.functionalAmount.negate())), 'ZMW');
        const onAccount = accountBalances(books, '2026-12-31').get(ACC.rounding) ?? Money.zero('ZMW');
        expect(onAccount.equals(roundingNet)).toBe(true);
        expect(books.journals.flatMap((j) => j.lines).every((l) => l.accountId !== ACC.rounding || l.isRounding)).toBe(true);
      },
    ), RUNS);
  });

  it('post-then-reverse of any journal leaves every account balance unchanged (§6.5)', () => {
    fc.assert(fc.property(fc.array(journalDraftArb, { maxLength: 10 }), fc.oneof(journalDraftArb, roundingDraftArb), (prefix, d) => {
      const ctx = testContext();
      let { books } = postAll(prefix, ctx);
      const before = nonZeroBalances(books);
      const posted = post(books, d, ctx);
      books = reverse(posted.books, { journalId: posted.journal.id, date: '2026-10-31', authorId: BOB, approverId: CAROL }, ctx).books;
      expect(nonZeroBalances(books)).toEqual(before);
      assertBooksInvariants(books);
    }), RUNS);
  });

  it('number series stay gapless under any mix of accepted and rejected drafts; a rejection consumes nothing (§6.7)', () => {
    type Fault = 'none' | 'unbalanced' | 'closed' | 'noPeriod' | 'crossTenant' | 'noAuthor' | 'inactive' | 'fx' | 'sod' | 'reverseTwice';
    const faultArb = fc.constantFrom<Fault>('none', 'none', 'none', 'unbalanced', 'closed', 'noPeriod', 'crossTenant', 'noAuthor', 'inactive', 'fx', 'sod', 'reverseTwice');
    const corrupt = (d: JournalDraft, f: Fault): JournalDraft => {
      switch (f) {
        case 'unbalanced':
          return { ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, amount: l.amount.add(Money.ofMinor(1n, l.amount.currency)) } : l)) };
        case 'closed':
          return { ...d, date: '2026-09-15', ...(d.fxRate ? { fxRate: { ...d.fxRate, rateDate: '2026-09-15' } } : {}) };
        case 'noPeriod':
          return { ...d, date: '2027-01-15' };
        case 'crossTenant':
          return { ...d, companyId: OTHER_CO };
        case 'noAuthor':
          return { ...d, authorId: UserId('  ') };
        case 'inactive':
          return { ...d, lines: d.lines.map((l, i) => (i === 0 ? { accountId: ACC.dormant, side: l.side, amount: l.amount } : l)) };
        case 'fx': {
          if (d.fxRate) {
            return { companyId: d.companyId, series: d.series, date: d.date, currency: d.currency, memo: d.memo, authorId: d.authorId, lines: d.lines };
          }
          return { ...d, fxRate: { from: 'ZMW', to: 'ZMW', rate: '1', source: 'TEST', rateDate: '2026-10-01' } };
        }
        default:
          return d;
      }
    };
    fc.assert(fc.property(fc.array(fc.tuple(journalDraftArb, faultArb, fc.nat()), { minLength: 1, maxLength: 30 }), (steps) => {
      let issued = 0;
      const ctx = testContext();
      const counting = { now: ctx.now, newJournalId: (): JournalId => { issued += 1; return ctx.newJournalId(); } };
      let books = postAll([]).books;
      let accepted = 0;
      for (const [d, fault, pick] of steps) {
        const before = snapshot(books);
        const issuedBefore = issued;
        let attempt: () => { books: CompanyBooks };
        let expectReject = fault !== 'none';
        if (fault === 'sod' || fault === 'reverseTwice') {
          const originals = books.journals.filter((j) => j.reversalOf === null);
          const target = originals[pick % Math.max(originals.length, 1)];
          if (!target) {
            attempt = () => post(books, d, counting);
            expectReject = false;
          } else if (fault === 'sod') {
            attempt = () => reverse(books, { journalId: target.id, date: '2026-10-31', authorId: ALICE, approverId: ALICE }, counting);
          } else {
            if (!books.reversals.has(target.id)) {
              books = reverse(books, { journalId: target.id, date: '2026-10-31', authorId: ALICE, approverId: BOB }, counting).books;
              accepted += 1;
            }
            const snapAfterFirst = snapshot(books);
            const issuedAfterFirst = issued;
            expect(errorCode(() => reverse(books, { journalId: target.id, date: '2026-10-31', authorId: ALICE, approverId: BOB }, counting))).toBe('ALREADY_REVERSED');
            expect(snapshot(books)).toBe(snapAfterFirst);
            expect(issued).toBe(issuedAfterFirst);
            continue;
          }
        } else {
          const draft = corrupt(d, fault);
          attempt = () => post(books, draft, counting);
        }
        if (expectReject) {
          expect(errorCode(attempt)).toBeDefined();
          expect(snapshot(books)).toBe(before);
          expect(issued).toBe(issuedBefore);
        } else {
          books = attempt().books;
          accepted += 1;
        }
      }
      expect(books.journals).toHaveLength(accepted);
      expect(issued).toBe(accepted);
      assertBooksInvariants(books);
      const total = [...books.seriesCounters.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(accepted);
    }), RUNS);
  });
});
