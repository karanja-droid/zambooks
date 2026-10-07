// Author-added guard tests (bake-off author, not the test-designer). They cover defensive
// branches the designer's suite cannot reach through openBooks-built fixtures.
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { AccountId, UserId } from './ids';
import type { CompanyBooks } from './model';
import { ACC, OTHER_CO, PARTY, demoBooks, draft, zmw } from './testing/fixtures';
import { prepareLines } from './validate';

describe('prepareLines: defensive guards', () => {
  it('rejects a non-string author as MISSING_AUTHOR (§6.8)', () => {
    const noAuthor = draft({ authorId: undefined as unknown as UserId });
    expect(errorCode(() => prepareLines(demoBooks(), noAuthor))).toBe('MISSING_AUTHOR');
  });

  it('rejects a whitespace-only author as MISSING_AUTHOR (§6.8)', () => {
    expect(errorCode(() => prepareLines(demoBooks(), draft({ authorId: UserId('   ') })))).toBe('MISSING_AUTHOR');
  });

  it('rejects a whitespace-only party on a control account as MISSING_PARTY (§6.4)', () => {
    const d = draft({
      lines: [
        { accountId: ACC.ar, side: 'DR', amount: zmw('5.00'), partyId: PARTY.customer.replace(/./g, ' ') as typeof PARTY.customer },
        { accountId: ACC.sales, side: 'CR', amount: zmw('5.00') },
      ],
    });
    expect(errorCode(() => prepareLines(demoBooks(), d))).toBe('MISSING_PARTY');
  });

  it('rejects a line whose account belongs to another company, even if it is in the map (§6.12)', () => {
    const base = demoBooks();
    const foreign = AccountId('a-foreign');
    const books: CompanyBooks = {
      ...base,
      accounts: new Map([
        ...base.accounts,
        [foreign, { id: foreign, companyId: OTHER_CO, code: '9000', name: 'Foreign', type: 'ASSET', control: null, active: true }],
      ]),
    };
    const d = draft({ lines: [{ accountId: foreign, side: 'DR', amount: zmw('1.00') }, { accountId: ACC.capital, side: 'CR', amount: zmw('1.00') }] });
    expect(errorCode(() => prepareLines(books, d))).toBe('CROSS_TENANT');
  });

  it('returns frozen lines', () => {
    const lines = prepareLines(demoBooks(), draft());
    for (const l of lines) expect(Object.isFrozen(l)).toBe(true);
  });
});
