import { Money, type CurrencyCode } from '@zambooks/shared';
import fc from 'fast-check';
import type { AccountId } from '../ids';
import type { DraftLine, JournalDraft, LedgerContext, PostedJournal, Side, CompanyBooks } from '../model';
import { post } from '../post';
import { ACC, ALICE, CO, PARTY, demoBooks, testContext } from './fixtures';

const POSTABLE = [ACC.cash, ACC.ar, ACC.inventory, ACC.ap, ACC.capital, ACC.sales, ACC.expenses] as const;

const rawLine = fc.record({
  acct: fc.integer({ min: 0, max: POSTABLE.length - 1 }),
  side: fc.constantFrom<Side>('DR', 'CR'),
  minor: fc.bigInt({ min: 1n, max: 1_000_000_000_00n }),
  customer: fc.boolean(),
});

/** Positive decimal string with up to 4 dp, built from integers so no float ever touches a rate. */
export const rateArb = fc.integer({ min: 1, max: 99_999_999 }).map((n) => `${Math.floor(n / 10_000)}.${String(n % 10_000).padStart(4, '0')}`);

const partyFor = (accountId: AccountId, customer: boolean) =>
  accountId === ACC.ar || accountId === ACC.ap ? (customer ? PARTY.customer : PARTY.supplier) : undefined;

export const journalDraftArb: fc.Arbitrary<JournalDraft> = fc
  .record({
    raw: fc.array(rawLine, { minLength: 1, maxLength: 8 }),
    currency: fc.constantFrom<CurrencyCode>('ZMW', 'USD'),
    rate: rateArb,
    day: fc.integer({ min: 1, max: 31 }),
    series: fc.constantFrom('GJ', 'SI', 'PI'),
  })
  .map(({ raw, currency, rate, day, series }) => {
    const lines: DraftLine[] = raw.map((r) => {
      const accountId = POSTABLE[r.acct] as AccountId;
      const partyId = partyFor(accountId, r.customer);
      return { accountId, side: r.side, amount: Money.ofMinor(r.minor, currency), ...(partyId ? { partyId } : {}) };
    });
    const net = raw.reduce((acc, r) => (r.side === 'DR' ? acc + r.minor : acc - r.minor), 0n);
    // A single line always has net != 0, so the offset line guarantees >= 2 lines and balance.
    if (net !== 0n) {
      lines.push({ accountId: ACC.cash, side: net > 0n ? 'CR' : 'DR', amount: Money.ofMinor(net > 0n ? net : -net, currency) });
    }
    return {
      companyId: CO,
      series,
      date: `2026-10-${String(day).padStart(2, '0')}`,
      currency,
      ...(currency === 'USD' ? { fxRate: { from: 'USD', to: 'ZMW', rate, source: 'TEST', rateDate: '2026-10-01' } as const } : {}),
      memo: 'generated',
      authorId: ALICE,
      lines,
    };
  });

/**
 * A USD draft that always needs a rounding line: m (even) one-cent debits at rate k.5 (k even)
 * each round half-even down to k minor, while the single m-cent credit converts exactly to
 * m*k + m/2. The functional imbalance is m/2 minor units, posted on the rounding account (§6.10).
 */
export const roundingDraftArb: fc.Arbitrary<JournalDraft> = fc
  .record({
    accts: fc.array(fc.record({ acct: fc.integer({ min: 0, max: POSTABLE.length - 1 }), customer: fc.boolean() }), { minLength: 1, maxLength: 4 }),
    k: fc.integer({ min: 0, max: 5_000 }),
    day: fc.integer({ min: 1, max: 31 }),
    series: fc.constantFrom('GJ', 'SI', 'PI'),
  })
  .map(({ accts, k, day, series }) => {
    const debits = [...accts, ...accts];
    const lines: DraftLine[] = debits.map((r) => {
      const accountId = POSTABLE[r.acct] as AccountId;
      const partyId = partyFor(accountId, r.customer);
      return { accountId, side: 'DR', amount: Money.ofMinor(1n, 'USD'), ...(partyId ? { partyId } : {}) };
    });
    lines.push({ accountId: ACC.cash, side: 'CR', amount: Money.ofMinor(BigInt(debits.length), 'USD') });
    return {
      companyId: CO,
      series,
      date: `2026-10-${String(day).padStart(2, '0')}`,
      currency: 'USD',
      fxRate: { from: 'USD', to: 'ZMW', rate: `${2 * k}.5`, source: 'TEST', rateDate: '2026-10-01' },
      memo: 'generated rounding',
      authorId: ALICE,
      lines,
    };
  });

/** Posts every draft in order. Pass `ctx` to keep issuing unique journal ids in later posts and reversals. */
export function postAll(drafts: readonly JournalDraft[], ctx: LedgerContext = testContext()): { books: CompanyBooks; journals: PostedJournal[] } {
  let books = demoBooks();
  const journals: PostedJournal[] = [];
  for (const d of drafts) {
    const r = post(books, d, ctx);
    books = r.books;
    journals.push(r.journal);
  }
  return { books, journals };
}
