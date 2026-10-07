import { describe, expect, it } from 'vitest';
import { AccountId, CompanyId, JournalId, PartyId, PeriodId, UserId } from './ids';

describe('branded ID constructors', () => {
  it('are identity functions at runtime', () => {
    expect(CompanyId('co-1')).toBe('co-1');
    expect(AccountId('a-1')).toBe('a-1');
    expect(PeriodId('per-1')).toBe('per-1');
    expect(JournalId('j-1')).toBe('j-1');
    expect(UserId('u-1')).toBe('u-1');
    expect(PartyId('p-1')).toBe('p-1');
  });
});
