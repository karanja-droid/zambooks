// Author-added tests (bake-off author, not the test-designer). commit() is the single write
// path shared by post() and reverse(), so it re-validates its input instead of trusting callers.
import { Money, errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { commit, type JournalHeader } from './commit';
import { AccountId, JournalId, UserId } from './ids';
import type { CompanyBooks, LedgerContext, PreparedLine } from './model';
import { post } from './post';
import { ACC, ALICE, BOB, PARTY, demoBooks, draft, testContext, usd, usdZmw, zmw } from './testing/fixtures';
import { prepareLines } from './validate';

const header = (overrides: Partial<JournalHeader> = {}): JournalHeader => ({
  series: 'GJ', date: '2026-10-15', currency: 'ZMW', memo: 'm', authorId: ALICE, approverId: null, reversalOf: null,
  ...overrides,
});

const zmwLines = () => prepareLines(demoBooks(), draft());

/** USD 0.01 + 0.01 DR / 0.02 CR at 0.5: produces a 0.01 ZMW rounding line on the debit side. */
const usdDraft = draft({
  currency: 'USD',
  fxRate: usdZmw('0.5'),
  lines: [
    { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
    { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
    { accountId: ACC.cash, side: 'CR', amount: usd('0.02') },
  ],
});
const usdLines = () => prepareLines(demoBooks(), usdDraft);
const usdHeader = header({ currency: 'USD' });
const roundingOf = (lines: readonly PreparedLine[]): PreparedLine => {
  const r = lines.find((l) => l.isRounding);
  if (!r) throw new Error('fixture has no rounding line');
  return r;
};

const edit = (lines: readonly PreparedLine[], i: number, patch: Partial<PreparedLine>): PreparedLine[] =>
  lines.map((l, j) => (j === i ? { ...l, ...patch } : l));

const flip = (lines: readonly PreparedLine[]): PreparedLine[] =>
  lines.map((l) => ({ ...l, side: l.side === 'DR' ? 'CR' : 'DR' }));

function countingContext(): LedgerContext & { calls: () => number } {
  const inner = testContext();
  let calls = 0;
  return {
    now: () => { calls += 1; return inner.now(); },
    newJournalId: () => { calls += 1; return inner.newJournalId(); },
    calls: () => calls,
  };
}

describe('commit: header guards', () => {
  it.each<[string, Partial<JournalHeader>, string]>([
    ['no author', { authorId: UserId('') }, 'MISSING_AUTHOR'],
    ['approver is the author (§8 SoD)', { approverId: ALICE }, 'SOD_VIOLATION'],
    ['blank approver', { approverId: UserId(' ') }, 'SOD_VIOLATION'],
    ['closed period (§6.6)', { date: '2026-09-10' }, 'PERIOD_CLOSED'],
    ['reversal of an unknown journal (§6.5)', { reversalOf: JournalId('nope') }, 'UNKNOWN_JOURNAL'],
  ])('%s', (_n, h, code) => {
    expect(errorCode(() => commit(demoBooks(), header(h), zmwLines(), testContext()))).toBe(code);
  });
});

describe('commit: line guards', () => {
  const zl = zmwLines();
  const ul = usdLines();
  it.each<[string, JournalHeader, PreparedLine[], string]>([
    ['one line', header(), zl.slice(0, 1), 'EMPTY_JOURNAL'],
    ['unknown account', header(), edit(zl, 0, { accountId: AccountId('a-x') }), 'UNKNOWN_ACCOUNT'],
    ['AR line without party', header(), edit(edit(zl, 0, { accountId: ACC.ar }), 1, { accountId: ACC.sales }), 'MISSING_PARTY'],
    ['txn currency differs from header', usdHeader, zl, 'CURRENCY_MISMATCH'],
    ['functional amount not in functional currency', header(), edit(zl, 0, { functionalAmount: usd('100.00') }), 'CURRENCY_MISMATCH'],
    ['blank rate source (§6.9)', header(), edit(zl, 0, { rateSource: ' ' }), 'BAD_FX_RATE'],
    ['rate dated after the journal (§6.9)', header(), edit(zl, 0, { rateDate: '2026-10-20' }), 'BAD_FX_RATE'],
    ['non-identity rate on a functional journal', header(), edit(zl, 0, { rate: '2' }), 'BAD_FX_RATE'],
    ['functional amount disagrees with the stored rate (§6.9)', usdHeader, edit(ul, 2, { functionalAmount: zmw('0.02') }), 'BAD_FX_RATE'],
    ['zero transaction amount on a normal line', header(), edit(zl, 0, { txnAmount: zmw('0'), functionalAmount: zmw('0') }), 'NON_POSITIVE_AMOUNT'],
    ['rounding line off the rounding account (§6.10)', usdHeader, edit(ul, 3, { accountId: ACC.expenses }), 'NO_ROUNDING_ACCOUNT'],
    ['rounding line with a transaction amount', usdHeader, edit(ul, 3, { txnAmount: usd('0.01') }), 'NON_POSITIVE_AMOUNT'],
    ['rounding line with zero functional amount', usdHeader, edit(ul, 3, { functionalAmount: zmw('0') }), 'NON_POSITIVE_AMOUNT'],
    ['unbalanced in transaction currency (§6.1)', header(), edit(zl, 0, { txnAmount: zmw('100.01'), functionalAmount: zmw('100.01') }), 'UNBALANCED'],
    ['unbalanced in functional currency: rounding line dropped (§6.1, §6.10)', usdHeader, ul.slice(0, 3), 'UNBALANCED'],
    ['two offsetting rounding lines', usdHeader, [...ul, { ...roundingOf(ul), side: 'CR' }, roundingOf(ul)], 'UNBALANCED'],
  ])('%s', (_n, h, lines, code) => {
    expect(errorCode(() => commit(demoBooks(), h, lines, testContext()))).toBe(code);
  });

  it('a rejection never touches the context, so no id or timestamp is consumed (§6.7)', () => {
    const ctx = countingContext();
    expect(errorCode(() => commit(demoBooks(), header(), zl.slice(0, 1), ctx))).toBe('EMPTY_JOURNAL');
    expect(ctx.calls()).toBe(0);
  });
});

describe('commit: reversals (§6.5)', () => {
  const setup = () => {
    const ctx = testContext();
    const { books, journal } = post(demoBooks(), usdDraft, ctx);
    const reversalHeader = header({ currency: 'USD', authorId: BOB, approverId: UserId('u-carol'), reversalOf: journal.id });
    return { ctx, books, journal, reversalHeader };
  };

  it('links the reversal to the original without mutating the input books', () => {
    const { ctx, books, journal, reversalHeader } = setup();
    const r = commit(books, reversalHeader, flip(journal.lines), ctx);
    expect(r.journal).toMatchObject({ reversalOf: journal.id, approverId: 'u-carol', number: 2 });
    expect(r.books.reversals.get(journal.id)).toBe(r.journal.id);
    expect(books.reversals.size).toBe(0);
    expect(r.books.accounts).not.toBe(books.accounts);
    expect(r.books.seriesCounters).not.toBe(books.seriesCounters);
    expect(Object.isFrozen(r.books)).toBe(true);
  });

  it('rejects a second reversal of the same journal', () => {
    const { ctx, books, journal, reversalHeader } = setup();
    const once = commit(books, reversalHeader, flip(journal.lines), ctx).books;
    expect(errorCode(() => commit(once, reversalHeader, flip(journal.lines), ctx))).toBe('ALREADY_REVERSED');
  });

  it('rejects reversing a reversal', () => {
    const { ctx, books, journal, reversalHeader } = setup();
    const r = commit(books, reversalHeader, flip(journal.lines), ctx);
    const again = { ...reversalHeader, reversalOf: r.journal.id };
    expect(errorCode(() => commit(r.books, again, journal.lines, ctx))).toBe('ALREADY_REVERSED');
  });
});

describe('commit: success', () => {
  it('copies only the PreparedLine fields onto posted lines', () => {
    const extra = zmwLines().map((l) => ({ ...l, smuggled: true }));
    const { journal } = commit(demoBooks(), header(), extra, testContext());
    expect(journal.lines[0]).not.toHaveProperty('smuggled');
    expect(journal.lines[0]?.txnAmount).toBeInstanceOf(Money);
  });

  it('accepts a party on a control-account line', () => {
    const lines = prepareLines(demoBooks(), draft({
      lines: [
        { accountId: ACC.ar, side: 'DR', amount: zmw('5.00'), partyId: PARTY.customer },
        { accountId: ACC.sales, side: 'CR', amount: zmw('5.00') },
      ],
    }));
    const books: CompanyBooks = demoBooks();
    expect(commit(books, header(), lines, testContext()).journal.lines[0]?.partyId).toBe(PARTY.customer);
  });
});
