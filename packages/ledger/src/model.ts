import type { CurrencyCode, FxRate, Money } from '@zambooks/shared';
import type { AccountId, CompanyId, JournalId, PartyId, PeriodId, UserId } from './ids';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type ControlKind = 'AR' | 'AP' | 'INVENTORY';
export type Side = 'DR' | 'CR';
export type PeriodStatus = 'OPEN' | 'CLOSED';

export interface Company {
  readonly id: CompanyId;
  readonly name: string;
  readonly functionalCurrency: CurrencyCode;
  /** §6.10: rounding differences post here, never silently. */
  readonly roundingAccountId: AccountId;
}

export interface Account {
  readonly id: AccountId;
  readonly companyId: CompanyId;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly control: ControlKind | null;
  readonly active: boolean;
}

export interface Period {
  readonly id: PeriodId;
  readonly companyId: CompanyId;
  /** Inclusive ISO dates. */
  readonly start: string;
  readonly end: string;
  readonly status: PeriodStatus;
}

export interface DraftLine {
  readonly accountId: AccountId;
  readonly side: Side;
  /** Positive, in the journal's transaction currency. */
  readonly amount: Money;
  /** Required on AR/AP control accounts (§6.4). */
  readonly partyId?: PartyId;
  readonly description?: string;
}

export interface JournalDraft {
  readonly companyId: CompanyId;
  readonly series: string;
  readonly date: string;
  readonly currency: CurrencyCode;
  /** Required when currency differs from the company's functional currency. */
  readonly fxRate?: FxRate;
  readonly memo: string;
  readonly authorId: UserId;
  readonly lines: readonly DraftLine[];
}

/** A line after validation and conversion, before it is numbered and stamped. */
export interface PreparedLine {
  readonly accountId: AccountId;
  readonly side: Side;
  readonly partyId: PartyId | null;
  readonly txnAmount: Money;
  readonly rate: string;
  readonly rateSource: string;
  readonly rateDate: string;
  readonly functionalAmount: Money;
  readonly isRounding: boolean;
}

export interface PostedLine extends PreparedLine {
  readonly lineNo: number;
  readonly companyId: CompanyId;
  readonly authorId: UserId;
  readonly postedAt: string;
}

export interface PostedJournal {
  readonly id: JournalId;
  readonly companyId: CompanyId;
  readonly series: string;
  readonly number: number;
  readonly date: string;
  readonly currency: CurrencyCode;
  readonly memo: string;
  readonly authorId: UserId;
  readonly approverId: UserId | null;
  readonly postedAt: string;
  readonly reversalOf: JournalId | null;
  readonly lines: readonly PostedLine[];
}

export interface CompanyBooks {
  readonly company: Company;
  readonly accounts: ReadonlyMap<AccountId, Account>;
  readonly periods: readonly Period[];
  readonly journals: readonly PostedJournal[];
  /** Last number issued per series; gapless per company and series (§6.7). */
  readonly seriesCounters: ReadonlyMap<string, number>;
  /** original journal id -> reversal journal id */
  readonly reversals: ReadonlyMap<JournalId, JournalId>;
}

export interface LedgerContext {
  now(): string;
  newJournalId(): JournalId;
}

export interface Actor {
  readonly id: UserId;
  readonly roles: readonly string[];
}

export interface AuditEvent {
  readonly type: 'PERIOD_CLOSED' | 'PERIOD_REOPENED';
  readonly companyId: CompanyId;
  readonly periodId: PeriodId;
  readonly actorId: UserId;
  readonly reason: string;
  readonly at: string;
}

export interface PostResult {
  readonly books: CompanyBooks;
  readonly journal: PostedJournal;
}
