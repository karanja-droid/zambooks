import { describe, expect, it } from 'vitest';
import { Money, MoneyError, sumMoney } from './money';
import { errorCode } from './testing';

describe('Money.parse', () => {
  it('parses exact decimals into minor units', () => {
    expect(Money.parse('1234.56', 'ZMW').minor).toBe(123456n);
    expect(Money.parse('7', 'ZMW').minor).toBe(700n);
    expect(Money.parse('0.5', 'USD').minor).toBe(50n);
    expect(Money.parse('-10.01', 'ZMW').minor).toBe(-1001n);
  });

  it('rejects excess precision instead of rounding', () => {
    expect(errorCode(() => Money.parse('1.005', 'ZMW'))).toBe('EXCESS_PRECISION');
  });

  it.each(['', '1e3', '1,000.00', ' 1.00', 'abc', '1.', '.5', 'NaN', 'Infinity', '+1'])('rejects %j', (s) => {
    expect(() => Money.parse(s, 'ZMW')).toThrowError(MoneyError);
    expect(errorCode(() => Money.parse(s, 'ZMW'))).toBe('INVALID_AMOUNT');
  });

  it('is exact beyond Number.MAX_SAFE_INTEGER', () => {
    expect(Money.parse('90071992547409.93', 'ZMW').minor).toBe(9007199254740993n);
  });
});

describe('Money arithmetic', () => {
  const a = Money.parse('10.25', 'ZMW');
  const b = Money.parse('0.75', 'ZMW');

  it('adds and subtracts exactly', () => {
    expect(a.add(b).toDecimalString()).toBe('11.00');
    expect(b.subtract(a).toDecimalString()).toBe('-9.50');
    expect(Money.parse('0.1', 'ZMW').add(Money.parse('0.2', 'ZMW')).equals(Money.parse('0.3', 'ZMW'))).toBe(true);
  });

  it('refuses to mix currencies', () => {
    expect(errorCode(() => a.add(Money.parse('1', 'USD')))).toBe('CURRENCY_MISMATCH');
    expect(errorCode(() => a.subtract(Money.parse('1', 'USD')))).toBe('CURRENCY_MISMATCH');
    expect(a.equals(Money.parse('10.25', 'USD'))).toBe(false);
  });

  it('negates and reports sign', () => {
    expect(a.negate().isNegative()).toBe(true);
    expect(a.isPositive()).toBe(true);
    expect(Money.zero('ZMW').isZero()).toBe(true);
    expect(Money.zero('ZMW').isPositive()).toBe(false);
  });

  it('is immutable', () => {
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('formats small and negative values', () => {
    expect(Money.ofMinor(5n, 'ZMW').toDecimalString()).toBe('0.05');
    expect(Money.ofMinor(-5n, 'ZMW').toDecimalString()).toBe('-0.05');
    expect(Money.ofMinor(123456n, 'USD').toDecimalString()).toBe('1234.56');
  });

  it('sums a list in one currency, zero for empty', () => {
    expect(sumMoney([a, b, a], 'ZMW').toDecimalString()).toBe('21.25');
    expect(sumMoney([], 'ZMW').isZero()).toBe(true);
    expect(errorCode(() => sumMoney([Money.parse('1', 'USD')], 'ZMW'))).toBe('CURRENCY_MISMATCH');
  });
});
