import { Money, convert, errorCode, identityRate, sumMoney } from '@zambooks/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openBooks } from './books';
import { AccountId, JournalId, PeriodId, UserId } from './ids';
import type { CompanyBooks, JournalDraft, LedgerContext, PostedJournal } from './model';
import { PERIOD_ADMIN, closePeriod, reopenPeriod } from './periods';
import { post } from './post';
import { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { reverse } from './reverse';
import { journalDraftArb, postAll, roundingDraftArb } from './testing/arbitraries';
import { ACC, ALICE, BOB, CAROL, CO, OTHER_CO, PERIOD, demoAccounts, demoPeriods, testContext } from './testing/fixtures';

const RUNS = { numRuns: 2000 };
/** 2,000 runs of whole-ledger properties take several seconds; vitest's 5 s default is too short. */
const SLOW = { timeout: 60_000 };
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
    fc.assert(fc.property(journalsArb, fc.integer({ min: 1, max: 31 }), (drafts, asOfDay) => {
      const { books, journals } = postAll(drafts);
      journals.forEach((j, ji) => {
        const d = drafts[ji] as JournalDraft;
        // §6.9 against an independent oracle: each draft line maps 1:1, in order, to a non-rounding posted line
        // stamped with the draft's rate (identity for ZMW) and the shared convert() of its amount.
        const used = d.fxRate ?? identityRate('ZMW', d.date);
        const plain = j.lines.filter((l) => !l.isRounding);
        expect(plain).toHaveLength(d.lines.length);
        plain.forEach((l, i) => {
          const dl = d.lines[i] as JournalDraft['lines'][number];
          expect(l.lineNo).toBe(i + 1);
          expect(l.accountId).toBe(dl.accountId);
          expect(l.side).toBe(dl.side);
          expect(l.partyId).toBe(dl.partyId ?? null);
          expect(l.txnAmount.equals(dl.amount)).toBe(true);
          expect({ rate: l.rate, rateSource: l.rateSource, rateDate: l.rateDate }).toEqual({ rate: used.rate, rateSource: used.source, rateDate: used.rateDate });
          if (d.currency === 'ZMW') expect(l.rate).toBe('1');
          expect(l.functionalAmount.equals(convert(l.txnAmount, used))).toBe(true);
        });
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
          expect(r.lineNo).toBe(j.lines.length);
          expect({ rate: r.rate, rateSource: r.rateSource, rateDate: r.rateDate }).toEqual({ rate: used.rate, rateSource: used.source, rateDate: used.rateDate });
        }
        if (d.currency === 'ZMW') expect(roundingLines).toHaveLength(0);
      });
      assertBooksInvariants(books);
      // §6.2 / §6.3 / §6.4 "at any date": a random October cut-off, which excludes later journals.
      const asOf = `2026-10-${String(asOfDay).padStart(2, '0')}`;
      const tb = trialBalance(books, asOf);
      expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true);
      expect(balanceSheetCheck(books, asOf).holds).toBe(true);
      expect(subledgerBalances(books, asOf, 'AR').reconciles).toBe(true);
      expect(subledgerBalances(books, asOf, 'AP').reconciles).toBe(true);
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
    fc.assert(fc.property(journalDraftArb, fc.nat(), fc.constantFrom(1n, -1n), (d, k, delta) => {
      const i = k % d.lines.length;
      const target = d.lines[i] as JournalDraft['lines'][number];
      const amount = target.amount.add(Money.ofMinor(delta, target.amount.currency));
      const lines = d.lines.map((l, idx) => (idx === i ? { ...l, amount } : l));
      // Taking a 1-minor line down to zero is caught earlier, by the positive-amount guard.
      const expected = amount.isZero() ? 'NON_POSITIVE_AMOUNT' : 'UNBALANCED';
      expect(errorCode(() => post(postAll([]).books, { ...d, lines }, testContext()))).toBe(expected);
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

  it('number series stay gapless under any mix of accepted and rejected operations; a rejection consumes nothing (§6.7)', () => {
    type Fault =
      | 'none' | 'unbalanced' | 'closed' | 'noPeriod' | 'crossTenant' | 'noAuthor' | 'inactive' | 'fx'
      | 'sod' | 'reverseTwice' | 'reverseReversal';
    const faultArb = fc.constantFrom<Fault>(
      'none', 'none', 'none', 'unbalanced', 'closed', 'noPeriod', 'crossTenant', 'noAuthor', 'inactive', 'fx',
      'sod', 'reverseTwice', 'reverseReversal',
    );
    type PostFault = Exclude<Fault, 'none' | 'sod' | 'reverseTwice' | 'reverseReversal'>;
    /** The corrupted draft and the exact code its guard must raise. */
    const corrupt = (d: JournalDraft, f: PostFault): [JournalDraft, string] => {
      switch (f) {
        case 'unbalanced':
          return [{ ...d, lines: d.lines.map((l, i) => (i === 0 ? { ...l, amount: l.amount.add(Money.ofMinor(1n, l.amount.currency)) } : l)) }, 'UNBALANCED'];
        case 'closed':
          return [{ ...d, date: '2026-09-15', ...(d.fxRate ? { fxRate: { ...d.fxRate, rateDate: '2026-09-15' } } : {}) }, 'PERIOD_CLOSED'];
        case 'noPeriod':
          return [{ ...d, date: '2027-01-15' }, 'NO_PERIOD'];
        case 'crossTenant':
          return [{ ...d, companyId: OTHER_CO }, 'CROSS_TENANT'];
        case 'noAuthor':
          return [{ ...d, authorId: UserId('  ') }, 'MISSING_AUTHOR'];
        case 'inactive':
          return [{ ...d, lines: d.lines.map((l, i) => (i === 0 ? { accountId: ACC.dormant, side: l.side, amount: l.amount } : l)) }, 'INACTIVE_ACCOUNT'];
        case 'fx':
          if (d.fxRate) {
            return [{ companyId: d.companyId, series: d.series, date: d.date, currency: d.currency, memo: d.memo, authorId: d.authorId, lines: d.lines }, 'MISSING_FX_RATE'];
          }
          return [{ ...d, fxRate: { from: 'ZMW', to: 'ZMW', rate: '1', source: 'TEST', rateDate: '2026-10-01' } }, 'BAD_FX_RATE'];
      }
    };
    const REV_DATE = '2026-10-31';
    fc.assert(fc.property(fc.array(fc.tuple(journalDraftArb, faultArb, fc.nat()), { minLength: 1, maxLength: 30 }), (steps) => {
      let issued = 0;
      const ctx = testContext();
      const counting: LedgerContext = { now: ctx.now, newJournalId: (): JournalId => { issued += 1; return ctx.newJournalId(); } };
      let books = postAll([]).books;
      let accepted = 0;
      /** An accepted operation leaves its input untouched (§6.5) and takes exactly one id and one number. */
      const accept = (run: (b: CompanyBooks) => { books: CompanyBooks }): void => {
        const before = snapshot(books);
        const next = run(books).books;
        expect(snapshot(books)).toBe(before);
        books = next;
        accepted += 1;
      };
      /** A rejected operation throws the exact code, leaves the books unchanged and takes no id. */
      const reject = (run: (b: CompanyBooks) => unknown, code: string): void => {
        const before = snapshot(books);
        const issuedBefore = issued;
        expect(errorCode(() => run(books))).toBe(code);
        expect(snapshot(books)).toBe(before);
        expect(issued).toBe(issuedBefore);
      };
      const reverseReq = (journalId: JournalId, approverId = BOB) => ({ journalId, date: REV_DATE, authorId: ALICE, approverId });
      for (const [d, fault, pick] of steps) {
        const pickFrom = <T,>(xs: readonly T[]): T | undefined => xs[pick % Math.max(xs.length, 1)];
        if (fault === 'none') {
          accept((b) => post(b, d, counting));
        } else if (fault === 'sod') {
          const target = pickFrom(books.journals.filter((j) => j.reversalOf === null && !books.reversals.has(j.id)));
          if (target) reject((b) => reverse(b, reverseReq(target.id, ALICE), counting), 'SOD_VIOLATION');
          else accept((b) => post(b, d, counting));
        } else if (fault === 'reverseTwice') {
          const target = pickFrom(books.journals.filter((j) => j.reversalOf === null));
          if (!target) {
            accept((b) => post(b, d, counting));
            continue;
          }
          if (!books.reversals.has(target.id)) accept((b) => reverse(b, reverseReq(target.id), counting));
          reject((b) => reverse(b, reverseReq(target.id), counting), 'ALREADY_REVERSED');
        } else if (fault === 'reverseReversal') {
          const target = pickFrom(books.journals.filter((j) => j.reversalOf !== null));
          if (target) reject((b) => reverse(b, reverseReq(target.id), counting), 'ALREADY_REVERSED');
          else accept((b) => post(b, d, counting));
        } else {
          const [draft, code] = corrupt(d, fault);
          reject((b) => post(b, draft, counting), code);
        }
      }
      expect(books.journals).toHaveLength(accepted);
      expect(issued).toBe(accepted);
      assertBooksInvariants(books);
      const total = [...books.seriesCounters.values()].reduce((a, b) => a + b, 0);
      expect(total).toBe(accepted);
    }), RUNS);
  });

  it('a tenant\'s books never accept another tenant\'s journals or account ids (§6.12, domain level)', () => {
    const toOther = (id: string) => AccountId(`o${id.slice(1)}`);
    const otherBooks = () =>
      openBooks(
        { id: OTHER_CO, name: 'Other Co Ltd', functionalCurrency: 'ZMW', roundingAccountId: toOther(ACC.rounding) },
        demoAccounts().map((a) => ({ ...a, id: toOther(a.id), companyId: OTHER_CO })),
        demoPeriods().map((p) => ({ ...p, id: PeriodId(`o-${p.id}`), companyId: OTHER_CO })),
      );
    const otherCtx = (): LedgerContext => {
      let n = 0;
      return { now: () => '2026-10-07T09:00:00.000Z', newJournalId: () => JournalId(`oj-${++n}`) };
    };
    const asOther = (d: JournalDraft): JournalDraft => ({
      ...d,
      companyId: OTHER_CO,
      lines: d.lines.map((l) => ({ ...l, accountId: toOther(l.accountId) })),
    });
    expect(errorCode(() => openBooks({ id: OTHER_CO, name: 'x', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding }, demoAccounts(), []))).toBe('CROSS_TENANT');
    fc.assert(fc.property(journalsArb, fc.array(journalDraftArb, { maxLength: 5 }), journalDraftArb, fc.nat(), (coDrafts, otherDrafts, d, pick) => {
      const co = postAll(coDrafts);
      let other = otherBooks();
      const oc = otherCtx();
      for (const od of otherDrafts) other = post(other, asOther(od), oc).books;
      const before = snapshot(other);
      const target = co.journals[pick % co.journals.length] as PostedJournal;
      // Reversing a CO journal against OTHER_CO's books cannot find it.
      expect(errorCode(() => reverse(other, { journalId: target.id, date: '2026-10-31', authorId: ALICE, approverId: BOB }, oc))).toBe('UNKNOWN_JOURNAL');
      // OTHER_CO's books given a draft in its own name but with CO account ids.
      expect(errorCode(() => post(other, { ...d, companyId: OTHER_CO }, oc))).toBe('UNKNOWN_ACCOUNT');
      expect(snapshot(other)).toBe(before);
      expect(other.journals.every((j) => j.companyId === OTHER_CO && j.lines.every((l) => l.companyId === OTHER_CO && l.accountId.startsWith('o-')))).toBe(true);
    }), RUNS);
  });
});
