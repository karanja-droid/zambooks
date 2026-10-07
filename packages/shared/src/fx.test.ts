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

  it('rounds half to even for negative amounts too (register ZM-0002)', () => {
    expect(convert(Money.parse('-0.01', 'USD'), usdZmw('0.5')).minor).toBe(0n);
    expect(convert(Money.parse('-0.03', 'USD'), usdZmw('0.5')).minor).toBe(-2n);
  });

  it('rounds normally (not to even) just above a tie', () => {
    expect(convert(Money.parse('0.02', 'USD'), usdZmw('0.2501')).minor).toBe(1n);
  });

  it('is exact for amounts beyond fixed decimal precision (I1 repro 1)', () => {
    expect(convert(Money.ofMinor(10n ** 50n + 1n, 'USD'), usdZmw('1.5')).minor).toBe(15n * 10n ** 49n + 2n);
  });

  it('is exact for rates beyond fixed decimal precision (I1 repro 2)', () => {
    const rate = `0.5${'0'.repeat(58)}1`;
    expect(convert(Money.ofMinor(1n, 'USD'), usdZmw(rate)).minor).toBe(1n);
  });

  it('rejects a same-currency rate that is not numerically 1 (I2)', () => {
    const notOne: FxRate = { from: 'ZMW', to: 'ZMW', rate: '2', source: 'BOZ', rateDate: '2026-10-01' };
    expect(errorCode(() => convert(Money.parse('1', 'ZMW'), notOne))).toBe('INVALID_RATE');
  });

  it('rejects a rate with a leading zero in the integer part (M2)', () => {
    expect(isValidRate('01.5')).toBe(false);
    expect(errorCode(() => convert(Money.parse('1', 'USD'), usdZmw('01.5')))).toBe('INVALID_RATE');
  });
});

describe('identityRate', () => {
  it('is 1 with source IDENTITY', () => {
    expect(identityRate('ZMW', '2026-10-07')).toEqual({
      from: 'ZMW', to: 'ZMW', rate: '1', source: 'IDENTITY', rateDate: '2026-10-07',
    });
  });
});
