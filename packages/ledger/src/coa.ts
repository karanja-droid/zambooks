import { z } from 'zod';
import { LedgerError } from './errors';
import type { AccountId, CompanyId } from './ids';
import type { Account, ControlKind } from './model';

/** Control kind -> the account type it must sit under (review M2). */
const REQUIRED_TYPE_FOR_CONTROL: Record<ControlKind, 'ASSET' | 'LIABILITY'> = {
  AR: 'ASSET',
  AP: 'LIABILITY',
  INVENTORY: 'ASSET',
};

const TemplateSchema = z
  .strictObject({
    templateId: z.string().min(1),
    version: z.string().min(1),
    status: z.enum(['VERIFY', 'VERIFIED']),
    registerRef: z.string().regex(/^ZM-\d{4}$/),
    roundingAccountCode: z.string().regex(/^\d{4}$/),
    accounts: z
      .array(
        z.strictObject({
          code: z.string().regex(/^\d{4}$/),
          name: z.string().min(1),
          type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
          control: z.enum(['AR', 'AP', 'INVENTORY']).nullable(),
          ifrsSme: z.string().regex(/^(SFP|SCI): .+/),
        }),
      )
      .min(1),
  })
  .superRefine((t, ctx) => {
    t.accounts.forEach((a, i) => {
      if (a.control !== null && a.type !== REQUIRED_TYPE_FOR_CONTROL[a.control]) {
        ctx.addIssue({
          code: 'custom',
          message: `control ${a.control} requires type ${REQUIRED_TYPE_FOR_CONTROL[a.control]}`,
          path: ['accounts', i, 'type'],
        });
      }
      if (a.code === t.roundingAccountCode && a.control !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'the rounding account must have control null',
          path: ['accounts', i, 'control'],
        });
      }
    });
  });

export interface InstantiatedTemplate {
  readonly accounts: Account[];
  readonly roundingAccountId: AccountId;
  readonly ifrsSmeMapping: ReadonlyMap<AccountId, string>;
  readonly status: 'VERIFY' | 'VERIFIED';
  readonly registerRef: string;
}

export function instantiateTemplate(raw: unknown, companyId: CompanyId, newAccountId: (code: string) => AccountId): InstantiatedTemplate {
  const parsed = TemplateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LedgerError('INVALID_TEMPLATE', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const t = parsed.data;
  const codes = new Set(t.accounts.map((a) => a.code));
  if (codes.size !== t.accounts.length) throw new LedgerError('INVALID_TEMPLATE', 'Duplicate account codes');
  const mapping = new Map<AccountId, string>();
  const accounts = t.accounts.map((a): Account => {
    const id = newAccountId(a.code);
    mapping.set(id, a.ifrsSme);
    return { id, companyId, code: a.code, name: a.name, type: a.type, control: a.control, active: true };
  });
  // Reuse the id already minted above for the rounding account rather than minting a
  // second one (review I1): a non-idempotent newAccountId would otherwise produce a
  // roundingAccountId that matches no account in `accounts`.
  const roundingAccount = accounts.find((a) => a.code === t.roundingAccountCode);
  if (!roundingAccount) throw new LedgerError('INVALID_TEMPLATE', 'Rounding account code not in template');
  return {
    accounts,
    roundingAccountId: roundingAccount.id,
    ifrsSmeMapping: mapping,
    status: t.status,
    registerRef: t.registerRef,
  };
}
