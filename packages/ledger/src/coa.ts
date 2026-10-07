import { z } from 'zod';
import { LedgerError } from './errors';
import type { AccountId, CompanyId } from './ids';
import type { Account } from './model';

const TemplateSchema = z.object({
  templateId: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(['VERIFY', 'VERIFIED']),
  registerRef: z.string().regex(/^ZM-\d{4}$/),
  roundingAccountCode: z.string().regex(/^\d{4}$/),
  accounts: z.array(z.object({
    code: z.string().regex(/^\d{4}$/),
    name: z.string().min(1),
    type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
    control: z.enum(['AR', 'AP', 'INVENTORY']).nullable(),
    ifrsSme: z.string().regex(/^(SFP|SCI): .+/),
  })).min(1),
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
  if (!parsed.success) throw new LedgerError('INVALID_TEMPLATE', parsed.error.issues.map((i) => i.message).join('; '));
  const t = parsed.data;
  const codes = new Set(t.accounts.map((a) => a.code));
  if (codes.size !== t.accounts.length) throw new LedgerError('INVALID_TEMPLATE', 'Duplicate account codes');
  if (!codes.has(t.roundingAccountCode)) throw new LedgerError('INVALID_TEMPLATE', 'Rounding account code not in template');
  const mapping = new Map<AccountId, string>();
  const accounts = t.accounts.map((a): Account => {
    const id = newAccountId(a.code);
    mapping.set(id, a.ifrsSme);
    return { id, companyId, code: a.code, name: a.name, type: a.type, control: a.control, active: true };
  });
  return { accounts, roundingAccountId: newAccountId(t.roundingAccountCode), ifrsSmeMapping: mapping, status: t.status, registerRef: t.registerRef };
}
