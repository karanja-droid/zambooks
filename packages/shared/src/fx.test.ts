import { describe, expect, it } from 'vitest';
import { convert, identityRate, isValidRate, type FxRate } from './fx';
import { Money } from './money';
import { errorCode } from './testing';

const usdZmw = (rate: string): FxRate => ({ from: 'USD', to: 'ZMW', rate, source: 'BOZ', rateDate: '2026-10-01' });

describe('convert', () => {
  it('converts with exact decimal maths', () => {
    expect(convert(Money.parse('100.00', 'USD'), usdZmw('26.4512')).toDecimalString()).toBe('2645.12');
    expect(convert(Money.parse('-100.00', 'USD'), usdZmw('26.4512')).toDecimalString()).toBe('-2645.12');
  });

  it('rounds half to even (register ZM-0002)', () => {
    expect(convert(Money.parse('0.01', 'USD'), usdZmw('0.5')).minor).toBe(0n);
    expect(convert(Money.parse('0.03', 'USD'), usdZmw('0.5')).minor).toBe(2n);
  });

  it('returns money in the target currency', () => {
    expect(convert(Money.parse('1', 'USD'), usdZmw('26')).currency).toBe('ZMW');
  });

  it('rejects an amount in the wrong source currency', () => {
    expect(errorCode(() => convert(Money.parse('1', 'ZMW'), usdZmw('26')))).toBe('CURRENCY_MISMATCH');
  });

  it.each(['0', '0.0000', '-1', '1e2', 'abc', '', ' 1'])('rejects rate %j', (r) => {
    expect(isValidRate(r)).toBe(false);
    expect(errorCode(() => convert(Money.parse('1', 'USD'), usdZmw(r)))).toBe('INVALID_RATE');
  });
});

describe('identityRate', () => {
  it('is 1 with source IDENTITY', () => {
    expect(identityRate('ZMW', '2026-10-07')).toEqual({
      from: 'ZMW', to: 'ZMW', rate: '1', source: 'IDENTITY', rateDate: '2026-10-07',
    });
  });
});
