import Decimal from 'decimal.js';
import { CURRENCIES, Money, MoneyError, type CurrencyCode } from './money';

export interface FxRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Units of `to` per one unit of `from`, as a plain positive decimal string. */
  readonly rate: string;
  readonly source: string;
  readonly rateDate: string;
}

const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

export function isValidRate(rate: string): boolean {
  return PLAIN_DECIMAL.test(rate) && new D(rate).gt(0);
}

export function convert(amount: Money, rate: FxRate): Money {
  if (amount.currency !== rate.from) {
    throw new MoneyError('CURRENCY_MISMATCH', `Amount is ${amount.currency}, rate is from ${rate.from}`);
  }
  if (!isValidRate(rate.rate)) throw new MoneyError('INVALID_RATE', `Invalid FX rate ${JSON.stringify(rate.rate)}`);
  const shift = CURRENCIES[rate.to].scale - CURRENCIES[rate.from].scale;
  const minor = new D(amount.minor.toString())
    .mul(rate.rate)
    .mul(new D(10).pow(shift))
    .toDecimalPlaces(0, D.ROUND_HALF_EVEN);
  return Money.ofMinor(BigInt(minor.toFixed(0)), rate.to);
}

export function identityRate(currency: CurrencyCode, rateDate: string): FxRate {
  return { from: currency, to: currency, rate: '1', source: 'IDENTITY', rateDate };
}
