export type LedgerErrorCode =
  | 'MISSING_AUTHOR'
  | 'CROSS_TENANT'
  | 'INVALID_DATE'
  | 'NO_PERIOD'
  | 'PERIOD_CLOSED'
  | 'EMPTY_JOURNAL'
  | 'UNKNOWN_ACCOUNT'
  | 'INACTIVE_ACCOUNT'
  | 'CURRENCY_MISMATCH'
  | 'NON_POSITIVE_AMOUNT'
  | 'MISSING_PARTY'
  | 'UNBALANCED'
  | 'MISSING_FX_RATE'
  | 'BAD_FX_RATE'
  | 'UNKNOWN_JOURNAL'
  | 'ALREADY_REVERSED'
  | 'SOD_VIOLATION'
  | 'FORBIDDEN'
  | 'UNKNOWN_PERIOD'
  | 'PERIOD_STATE'
  | 'REASON_REQUIRED'
  | 'DUPLICATE_ACCOUNT_CODE'
  | 'NO_ROUNDING_ACCOUNT'
  | 'INVALID_PERIODS'
  | 'INVALID_TEMPLATE';

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
