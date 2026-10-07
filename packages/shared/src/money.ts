export type CurrencyCode = 'ZMW' | 'USD' | 'ZAR' | 'EUR' | 'GBP';

export interface Currency {
  readonly code: CurrencyCode;
  readonly scale: number;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, Currency>> = Object.freeze({
  ZMW: { code: 'ZMW', scale: 2 },
  USD: { code: 'USD', scale: 2 },
  ZAR: { code: 'ZAR', scale: 2 },
  EUR: { code: 'EUR', scale: 2 },
  GBP: { code: 'GBP', scale: 2 },
});

export type MoneyErrorCode = 'CURRENCY_MISMATCH' | 'INVALID_AMOUNT' | 'EXCESS_PRECISION' | 'INVALID_RATE';

export class MoneyError extends Error {
  constructor(
    readonly code: MoneyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: CurrencyCode,
  ) {
    Object.freeze(this);
  }

  static ofMinor(minor: bigint, currency: CurrencyCode): Money {
    return new Money(minor, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  static parse(amount: string, currency: CurrencyCode): Money {
    const m = DECIMAL.exec(amount);
    if (!m) throw new MoneyError('INVALID_AMOUNT', `Not a plain decimal amount: ${JSON.stringify(amount)}`);
    const scale = CURRENCIES[currency].scale;
    const frac = m[3] ?? '';
    if (frac.length > scale) {
      throw new MoneyError('EXCESS_PRECISION', `${amount} has more than ${scale} decimals for ${currency}`);
    }
    const minor = BigInt(`${m[2]}${frac.padEnd(scale, '0')}`);
    return new Money(m[1] ? -minor : minor, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isPositive(): boolean {
    return this.minor > 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  toDecimalString(): string {
    const scale = CURRENCIES[this.currency].scale;
    const negative = this.minor < 0n;
    const digits = (negative ? -this.minor : this.minor).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${frac}` : ''}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError('CURRENCY_MISMATCH', `Cannot combine ${this.currency} with ${other.currency}`);
    }
  }
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
}
