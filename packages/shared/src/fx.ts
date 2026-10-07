import { CURRENCIES, Money, MoneyError, type CurrencyCode } from './money';

export interface FxRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  /** Units of `to` per one unit of `from`, as a plain positive decimal string. */
  readonly rate: string;
  readonly source: string;
  readonly rateDate: string;
}

/** No leading zeros in the integer part (other than a bare "0"). */
const PLAIN_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

interface ParsedRate {
  readonly num: bigint;
  readonly den: bigint;
}

function tryParseRate(rate: string): ParsedRate | null {
  const m = PLAIN_DECIMAL.exec(rate);
  if (!m) return null;
  const intPart = m[1];
  const fracPart = m[2] ? m[2].slice(1) : '';
  const num = BigInt(intPart + fracPart);
  if (num <= 0n) return null;
  return { num, den: 10n ** BigInt(fracPart.length) };
}

export function isValidRate(rate: string): boolean {
  return tryParseRate(rate) !== null;
}

/** Sign-aware half-even division of n / d, for d > 0. */
function divideHalfEven(n: bigint, d: bigint): bigint {
  const negative = n < 0n;
  const absN = negative ? -n : n;
  let q = absN / d;
  const r = absN % d;
  const twiceR = r * 2n;
  if (twiceR > d || (twiceR === d && q % 2n !== 0n)) q += 1n;
  return negative ? -q : q;
}

export function convert(amount: Money, rate: FxRate): Money {
  if (amount.currency !== rate.from) {
    throw new MoneyError('CURRENCY_MISMATCH', `Amount is ${amount.currency}, rate is from ${rate.from}`);
  }
  const parsed = tryParseRate(rate.rate);
  if (!parsed) throw new MoneyError('INVALID_RATE', `Invalid FX rate ${JSON.stringify(rate.rate)}`);
  const { num, den } = parsed;
  if (rate.from === rate.to && num !== den) {
    throw new MoneyError('INVALID_RATE', `Same-currency rate must be 1, got ${JSON.stringify(rate.rate)}`);
  }
  const toScale = CURRENCIES[rate.to].scale;
  const fromScale = CURRENCIES[rate.from].scale;
  const numerator = amount.minor * num * 10n ** BigInt(toScale);
  const denominator = den * 10n ** BigInt(fromScale);
  return Money.ofMinor(divideHalfEven(numerator, denominator), rate.to);
}

export function identityRate(currency: CurrencyCode, rateDate: string): FxRate {
  return { from: currency, to: currency, rate: '1', source: 'IDENTITY', rateDate };
}
