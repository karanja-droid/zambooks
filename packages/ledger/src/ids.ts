declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type CompanyId = Brand<string, 'CompanyId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type PeriodId = Brand<string, 'PeriodId'>;
export type JournalId = Brand<string, 'JournalId'>;
export type UserId = Brand<string, 'UserId'>;
export type PartyId = Brand<string, 'PartyId'>;

export const CompanyId = (s: string) => s as CompanyId;
export const AccountId = (s: string) => s as AccountId;
export const PeriodId = (s: string) => s as PeriodId;
export const JournalId = (s: string) => s as JournalId;
export const UserId = (s: string) => s as UserId;
export const PartyId = (s: string) => s as PartyId;
