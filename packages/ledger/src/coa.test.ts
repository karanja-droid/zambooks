import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import template from '../templates/zm-sme-default.json';
import { openBooks } from './books';
import { instantiateTemplate } from './coa';
import { AccountId } from './ids';
import { CO } from './testing/fixtures';

const id = (code: string) => AccountId(`acc-${code}`);

describe('zm-sme-default template', () => {
  const result = instantiateTemplate(template, CO, id);

  it('is marked VERIFY with a register reference (§0.5, §10)', () => {
    expect(result.status).toBe('VERIFY');
    expect(result.registerRef).toBe('ZM-0001');
  });

  it('has exactly one AR, one AP and one inventory control account', () => {
    for (const kind of ['AR', 'AP', 'INVENTORY'] as const) {
      expect(result.accounts.filter((a) => a.control === kind)).toHaveLength(1);
    }
  });

  it('maps every account to an IFRS for SMEs line', () => {
    for (const a of result.accounts) expect(result.ifrsSmeMapping.get(a.id)).toMatch(/^(SFP|SCI): /);
  });

  it('opens valid books for the company', () => {
    const books = openBooks(
      { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: result.roundingAccountId },
      result.accounts,
      [],
    );
    expect(books.accounts.size).toBe(result.accounts.length);
    expect(result.accounts.every((a) => a.companyId === CO && a.active)).toBe(true);
  });
});

describe('instantiateTemplate reuses minted ids for the rounding account (review I1)', () => {
  it('does not mint a second id for the rounding account', () => {
    let calls = 0;
    const counterId = (code: string) => {
      calls += 1;
      return AccountId(`acc-${code}-${calls}`);
    };

    const result = instantiateTemplate(template, CO, counterId);

    expect(result.accounts.some((a) => a.id === result.roundingAccountId)).toBe(true);
    expect(calls).toBe(result.accounts.length);

    const books = openBooks(
      { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: result.roundingAccountId },
      result.accounts,
      [],
    );
    expect(books.accounts.size).toBe(result.accounts.length);
  });
});

describe('instantiateTemplate rejects bad templates', () => {
  const base = structuredClone(template);
  it.each([
    ['not an object', 42],
    ['bad status', { ...base, status: 'APPROVED' }],
    ['bad register ref', { ...base, registerRef: 'X-1' }],
    ['duplicate codes', { ...base, accounts: [...base.accounts, base.accounts[0]] }],
    ['missing rounding account', { ...base, roundingAccountCode: '0000' }],
    ['bad account type', { ...base, accounts: [{ ...base.accounts[0], type: 'REVENUE' }] }],
  ])('%s', (_n, raw) => {
    expect(errorCode(() => instantiateTemplate(raw, CO, id))).toBe('INVALID_TEMPLATE');
  });
});
