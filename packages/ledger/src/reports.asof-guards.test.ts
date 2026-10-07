import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { post } from './post';
import { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { demoBooks, draft, testContext } from './testing/fixtures';

// Final review M1: a malformed as-of date must not silently produce a wrong, balanced report.
describe('reports reject an as-of date that is not YYYY-MM-DD', () => {
  const books = post(demoBooks(), draft({ date: '2026-10-15' }), testContext()).books;
  const reports = {
    accountBalances: (d: string) => accountBalances(books, d),
    trialBalance: (d: string) => trialBalance(books, d),
    balanceSheetCheck: (d: string) => balanceSheetCheck(books, d),
    subledgerBalances: (d: string) => subledgerBalances(books, d, 'AR'),
  };
  for (const [name, run] of Object.entries(reports)) {
    it.each(['2026-9-30', '2026-10', 'zzz', '2026-02-30'])(`${name} rejects %s`, (asOf) => {
      expect(errorCode(() => run(asOf))).toBe('INVALID_DATE');
    });
  }
});
