# ZamBooks Plan 01: Foundation and Pure Ledger Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The agent topology, parallel waves and bake-off are defined in `2026-10-07-zambooks-roadmap-and-agent-orchestration.md`.

**Goal:** Ship a pnpm/Turborepo monorepo with CI gates and a pure, I/O-free double-entry ledger (`packages/ledger`). The ledger proves spec §6 invariants 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and 12 (domain level) with unit tests and property-based tests.

**Architecture:**
- The ledger is a set of pure functions over an immutable `CompanyBooks` value: `post`, `reverse`, `closePeriod`, `reopenPeriod`, `trialBalance`.
- Every function returns new books and never mutates the input, so a failed operation cannot leave partial state.
- Money is a `bigint` of minor units wrapped in a frozen `Money` class. FX rates are decimal strings evaluated with `decimal.js`.
- Persistence, RLS, auth and the API come in plans 02–04 and wrap this core without changing its contracts.

**Tech Stack:**

| Area | Tools |
|---|---|
| Runtime | Node 22, TypeScript strict, pnpm 10 workspaces, Turborepo 2 |
| Tests | Vitest 3 + v8 coverage, fast-check |
| Lint | ESLint 9 flat config + typescript-eslint |
| Libraries | decimal.js, zod |
| CI | GitHub Actions |

**Spec:** `md files/ZamBooks working.md` (copied to `/CLAUDE.md` in Task 11)

## Global Constraints

- "Money is never a float. Use integer minor units or a decimal type." (§0.3)
- "Nothing financial is hard-deleted. Void or reverse instead." (§0.4)
- "Tax rates, thresholds and statutory rules live in versioned data, never in code. Every value is marked `VERIFY`." (§0.5)
- Claude Code may add `VERIFY` register entries but may never mark one `VERIFIED` (§10).
- Never claim "ACCA-approved", "ZRA-approved" or "tested" without written external confirmation (§0.6).
- Node 22 LTS, TypeScript strict (§2).
- `packages/ledger` is pure: no I/O, no `Date.now()`, no randomness. Time and IDs come in through `LedgerContext` (§13).
- Every line references an account **ID**, never a name (§6.8).
- Coverage: `packages/ledger` 100% lines/branches/functions/statements; `packages/shared` ≥ 90% (§9).
- Property runs: at least 2,000 cases per invariant property (§9: "thousands").
- Tests are committed red before implementation. An author never edits a `*.test.ts` file written by the test-designer (§3 and the roadmap's red-green split).
- Conventional commits, one logical change per commit (§3.9).

## Review Focus

1. **Amount strings that look valid to a person**, such as `"1,000.00"`, `"1.005"`, `" 1.00"` and `"1e3"`. These must be rejected, never rounded or partially parsed. Pinned in Task 2.
2. **Amounts beyond 2^53**, such as `"90071992547409.93"`. These must stay exact. Pinned in Task 2.
3. **Impossible calendar dates** such as `2026-02-30`. These must give `INVALID_DATE`, not silently roll into March. Pinned in Tasks 2 and 5.
4. **FX rates dated after the journal**, or written with an exponent or a sign. These must give `BAD_FX_RATE`. Pinned in Task 5.
5. **A rejected post** must not consume a journal number or change the books. This keeps numbering gapless and posting atomic. Pinned in Task 6. Also: a reversal dated before its original is rejected (Task 7).

---

## File Structure

```
/package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.js, .nvmrc, .gitignore
/.github/workflows/ci.yml
/CLAUDE.md                                   copy of the spec
/CHANGELOG.md
/scripts/check-register.mjs (+ .test.mjs)    compliance-register linter
/docs/adr/0000-template.md, 0001..0003       ADRs
/docs/compliance/register.md                 VERIFY register
/.claude/agents/*.md                         5 subagents
/.claude/commands/*.md                       5 slash commands
/.claude/hooks/*.sh (+ test-hooks.sh)        PreToolUse / PostToolUse / Stop
/.claude/settings.json
/packages/shared/src/
  money.ts        Money, MoneyError, CURRENCIES, sumMoney
  fx.ts           FxRate, convert, identityRate, isValidRate
  dates.ts        isIsoDate
  testing.ts      errorCode() test helper
  index.ts
/packages/ledger/src/
  ids.ts          branded IDs + constructors
  model.ts        Company, Account, Period, drafts, posted journals, CompanyBooks, LedgerContext
  errors.ts       LedgerError + every error code (fixed up front so parallel tasks never collide)
  books.ts        openBooks
  validate.ts     findOpenPeriod, prepareLines (§6.1, 8, 9, 10, 12 checks + conversion + rounding)
  commit.ts       commit (numbering, freezing, state transition)
  post.ts         post
  reverse.ts      reverse
  periods.ts      closePeriod, reopenPeriod
  coa.ts          instantiateTemplate (Zod-validated CoA template)
  reports.ts      accountBalances, trialBalance, balanceSheetCheck, subledgerBalances
  testing/fixtures.ts     deterministic demo company, context, draft builder
  testing/arbitraries.ts  fast-check generators
  index.ts
/packages/ledger/templates/zm-sme-default.json
```

---

### Task 1: Monorepo scaffold, git, CI

**Agent:** orchestrator, Wave A, serial. Haiku is acceptable for the boilerplate.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.nvmrc`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/shared/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/ledger/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`

**Interfaces:**
- Produces: root scripts `pnpm typecheck | lint | test | test:invariants | coverage | check:register`. Workspace packages `@zambooks/shared` and `@zambooks/ledger` are consumed as TS source via `exports: "./src/index.ts"`. Test files named `*.invariant.test.ts` make up the invariant suite.

- [ ] **Step 1: Initialise git and the workspace**

```bash
cd "/home/kahuna/ENT Account App"
git init -b main
printf 'node_modules/\ncoverage/\ndist/\n.turbo/\n.claude/active-register-ref\n' > .gitignore
echo 22 > .nvmrc
mkdir -p packages/shared/src packages/ledger/src .github/workflows
```

- [ ] **Step 2: Write root config files**

`package.json`:
```json
{
  "name": "zambooks",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.28.2",
  "engines": { "node": ">=22 <23" },
  "scripts": {
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:invariants": "turbo run test:invariants",
    "coverage": "turbo run coverage",
    "check:register": "node scripts/check-register.mjs docs/compliance/register.md"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "typecheck": {},
    "lint": {},
    "test": {},
    "test:invariants": {},
    "coverage": { "outputs": ["coverage/**"] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`eslint.config.js`:
```js
import tseslint from 'typescript-eslint';

const FLOAT_MESSAGE = 'Money is never a float (spec §0.3). Use Money / decimal.js.';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**'] },
  ...tseslint.configs.strict,
  {
    files: ['packages/shared/src/**/*.ts', 'packages/ledger/src/**/*.ts', 'packages/tax-zm/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: FLOAT_MESSAGE }],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: FLOAT_MESSAGE },
        { object: 'Math', property: 'round', message: FLOAT_MESSAGE },
      ],
    },
  },
);
```
Arithmetic operators on `Money` objects are already a TypeScript compile error. This rule catches the remaining float escape hatches.

- [ ] **Step 3: Write package skeletons**

`packages/shared/package.json`:
```json
{
  "name": "@zambooks/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "lint": "eslint src",
    "test": "vitest run --passWithNoTests",
    "test:invariants": "vitest run invariant --passWithNoTests",
    "coverage": "vitest run --coverage --passWithNoTests"
  }
}
```

`packages/ledger/package.json`: the same, with `"name": "@zambooks/ledger"` and `"dependencies": { "@zambooks/shared": "workspace:*" }`.

Both `tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "templates"] }
```

`packages/ledger/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
```
Create `packages/shared/vitest.config.ts` the same way, with thresholds of `90` and `exclude: ['src/**/*.test.ts', 'src/testing.ts', 'src/index.ts']`.

Both `src/index.ts`:
```ts
export {};
```

- [ ] **Step 4: Install dependencies**

```bash
pnpm add -Dw turbo typescript eslint typescript-eslint
pnpm --filter @zambooks/shared add decimal.js
pnpm --filter @zambooks/shared add -D vitest @vitest/coverage-v8 typescript
pnpm --filter @zambooks/ledger add zod
pnpm --filter @zambooks/ledger add -D vitest @vitest/coverage-v8 fast-check typescript
```

- [ ] **Step 5: Prove the float lint gate fails red, then remove the probe**

```bash
echo 'export const x = parseFloat("1.1");' > packages/shared/src/probe.ts
pnpm lint
```
Expected: FAIL with `Money is never a float (spec §0.3)`.
```bash
rm packages/shared/src/probe.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm test:invariants
      - run: pnpm coverage
      - run: pnpm check:register
      - run: node --test scripts/*.test.mjs
```
`check:register` and `node --test` fail until Task 11 lands. Waves B–I merge into `main` only after Task 11, or CI is accepted as red on those two steps until then.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm/turbo monorepo with strict TS, lint float ban and CI"
```

---

### Task 2: `Money` and dates (`packages/shared`)

**Agent:** test-designer (opus) writes Step 1 and commits red. Author: opus. Reviewer: fable. Wave B, parallel with T10 and T11.

**Files:**
- Create: `packages/shared/src/money.ts`, `dates.ts`, `testing.ts`
- Test: `packages/shared/src/money.test.ts`, `dates.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type CurrencyCode = 'ZMW' | 'USD' | 'ZAR' | 'EUR' | 'GBP'`
  - `CURRENCIES: Record<CurrencyCode, {code, scale}>`
  - `class Money { minor: bigint; currency: CurrencyCode; static ofMinor(minor: bigint, c): Money; static zero(c): Money; static parse(s: string, c): Money; add; subtract; negate; isZero; isPositive; isNegative; equals; toDecimalString(): string }`
  - `class MoneyError extends Error { code: 'CURRENCY_MISMATCH' | 'INVALID_AMOUNT' | 'EXCESS_PRECISION' | 'INVALID_RATE' }`
  - `sumMoney(items: readonly Money[], c: CurrencyCode): Money`
  - `isIsoDate(s: string): boolean`
  - `errorCode(fn: () => unknown): string | undefined`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/money.test.ts`:
```ts
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
```

`packages/shared/src/dates.test.ts`:
```ts
import { expect, it } from 'vitest';
import { isIsoDate } from './dates';

it.each(['2026-10-07', '2024-02-29', '2026-12-31'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', '07/10/2026', '', '2026-10-07T00:00:00Z'])(
  'rejects %j',
  (d) => expect(isIsoDate(d)).toBe(false),
);
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/shared test`
Expected: FAIL with `Cannot find module './money'`.
```bash
git add packages/shared/src/*.test.ts && git commit -m "test(shared): failing tests for Money and ISO dates"
```

- [ ] **Step 3: Implement**

`packages/shared/src/testing.ts`:
```ts
export function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}
```

`packages/shared/src/money.ts`:
```ts
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
```

`packages/shared/src/dates.ts`:
```ts
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
```

`packages/shared/src/index.ts`:
```ts
export { CURRENCIES, Money, MoneyError, sumMoney } from './money';
export type { Currency, CurrencyCode, MoneyErrorCode } from './money';
export { isIsoDate } from './dates';
export { errorCode } from './testing';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/shared coverage && pnpm typecheck && pnpm lint`
Expected: PASS, with coverage at or above 90%.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): bigint minor-unit Money and strict ISO date check"
```

---

### Task 3: FX conversion (`packages/shared/src/fx.ts`)

**Agent:** test-designer, then the opus author and the fable reviewer. Wave C.

**Files:**
- Create: `packages/shared/src/fx.ts`
- Test: `packages/shared/src/fx.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Money`, `MoneyError`, `CURRENCIES`, `CurrencyCode` (Task 2).
- Produces:
  - `interface FxRate { from: CurrencyCode; to: CurrencyCode; rate: string; source: string; rateDate: string }`
  - `isValidRate(rate: string): boolean`
  - `convert(amount: Money, rate: FxRate): Money`, which rounds half-even (register ZM-0002)
  - `identityRate(currency: CurrencyCode, rateDate: string): FxRate`, which returns rate `'1'` and source `'IDENTITY'`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/fx.test.ts`:
```ts
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
});

describe('identityRate', () => {
  it('is 1 with source IDENTITY', () => {
    expect(identityRate('ZMW', '2026-10-07')).toEqual({
      from: 'ZMW', to: 'ZMW', rate: '1', source: 'IDENTITY', rateDate: '2026-10-07',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/shared test fx`
Expected: FAIL with `Cannot find module './fx'`.
```bash
git add packages/shared/src/fx.test.ts && git commit -m "test(shared): failing tests for FX conversion"
```

- [ ] **Step 3: Implement**

`packages/shared/src/fx.ts`:
```ts
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
```

Append to `packages/shared/src/index.ts`:
```ts
export { convert, identityRate, isValidRate } from './fx';
export type { FxRate } from './fx';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/shared coverage && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): decimal FX conversion with half-even rounding"
```

---

### Task 4: Ledger domain model, errors, `openBooks`, fixtures

**Agent:** test-designer (opus) writes `testing/fixtures.ts` and `books.test.ts`, then the opus author and the fable reviewer. Wave D.

**Files:**
- Create: `packages/ledger/src/ids.ts`, `model.ts`, `errors.ts`, `books.ts`, `testing/fixtures.ts`
- Test: `packages/ledger/src/books.test.ts`
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**
- Consumes: `Money`, `FxRate`, `CurrencyCode` from `@zambooks/shared`.
- Produces (used by every later task):
  - Branded IDs `CompanyId | AccountId | PeriodId | JournalId | UserId | PartyId`, each with a same-named constructor `(s: string) => Id`.
  - All model interfaces below.
  - `class LedgerError { code: LedgerErrorCode }`, with the complete code list.
  - `openBooks(company: Company, accounts: readonly Account[], periods: readonly Period[]): CompanyBooks`
  - Fixtures: `CO`, `OTHER_CO`, `ACC`, `ALICE`, `BOB`, `CAROL`, `PARTY`, `PERIOD`, `demoAccounts()`, `demoBooks()`, `testContext()`, `zmw()`, `usd()`, `usdZmw()`, `draft()`

- [ ] **Step 1: Write the model, IDs and errors.** These are types and constants with no behaviour, so the test-designer writes them with the fixtures.

`packages/ledger/src/ids.ts`:
```ts
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
```

`packages/ledger/src/model.ts`:
```ts
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
```

`packages/ledger/src/errors.ts` (the complete list, fixed now so the parallel Wave F tasks never edit this file):
```ts
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
```

- [ ] **Step 2: Write the fixtures and the failing `openBooks` tests**

`packages/ledger/src/testing/fixtures.ts`:
```ts
import { Money, type FxRate } from '@zambooks/shared';
import { openBooks } from '../books';
import { AccountId, CompanyId, JournalId, PartyId, PeriodId, UserId } from '../ids';
import type { Account, AccountType, CompanyBooks, ControlKind, JournalDraft, LedgerContext, Period } from '../model';

export const CO = CompanyId('co-1');
export const OTHER_CO = CompanyId('co-2');
export const ALICE = UserId('u-alice');
export const BOB = UserId('u-bob');
export const CAROL = UserId('u-carol');
export const PARTY = { customer: PartyId('p-cust-1'), supplier: PartyId('p-supp-1') } as const;

export const ACC = {
  cash: AccountId('a-1000'),
  ar: AccountId('a-1200'),
  inventory: AccountId('a-1300'),
  dormant: AccountId('a-1999'),
  ap: AccountId('a-2000'),
  capital: AccountId('a-3000'),
  sales: AccountId('a-4000'),
  expenses: AccountId('a-5000'),
  rounding: AccountId('a-8999'),
} as const;

export const PERIOD = {
  sep: PeriodId('per-2026-09'),
  oct: PeriodId('per-2026-10'),
  nov: PeriodId('per-2026-11'),
} as const;

const acct = (
  id: AccountId, code: string, name: string, type: AccountType,
  control: ControlKind | null = null, active = true,
): Account => ({ id, companyId: CO, code, name, type, control, active });

export function demoAccounts(): Account[] {
  return [
    acct(ACC.cash, '1000', 'Cash at bank', 'ASSET'),
    acct(ACC.ar, '1200', 'Trade receivables', 'ASSET', 'AR'),
    acct(ACC.inventory, '1300', 'Inventory', 'ASSET', 'INVENTORY'),
    acct(ACC.dormant, '1999', 'Dormant suspense', 'ASSET', null, false),
    acct(ACC.ap, '2000', 'Trade payables', 'LIABILITY', 'AP'),
    acct(ACC.capital, '3000', 'Share capital', 'EQUITY'),
    acct(ACC.sales, '4000', 'Sales', 'INCOME'),
    acct(ACC.expenses, '5000', 'Operating expenses', 'EXPENSE'),
    acct(ACC.rounding, '8999', 'FX rounding differences', 'EXPENSE'),
  ];
}

export function demoPeriods(): Period[] {
  return [
    { id: PERIOD.sep, companyId: CO, start: '2026-09-01', end: '2026-09-30', status: 'CLOSED' },
    { id: PERIOD.oct, companyId: CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' },
    { id: PERIOD.nov, companyId: CO, start: '2026-11-01', end: '2026-11-30', status: 'OPEN' },
  ];
}

export function demoBooks(): CompanyBooks {
  return openBooks(
    { id: CO, name: 'Demo Retail Ltd', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding },
    demoAccounts(),
    demoPeriods(),
  );
}

export function testContext(): LedgerContext {
  let n = 0;
  return { now: () => '2026-10-07T09:00:00.000Z', newJournalId: () => JournalId(`j-${++n}`) };
}

export const zmw = (s: string) => Money.parse(s, 'ZMW');
export const usd = (s: string) => Money.parse(s, 'USD');
export const usdZmw = (rate: string, rateDate = '2026-10-01'): FxRate => ({
  from: 'USD', to: 'ZMW', rate, source: 'BOZ', rateDate,
});

export function draft(overrides: Partial<JournalDraft> = {}): JournalDraft {
  return {
    companyId: CO,
    series: 'GJ',
    date: '2026-10-15',
    currency: 'ZMW',
    memo: 'test journal',
    authorId: ALICE,
    lines: [
      { accountId: ACC.cash, side: 'DR', amount: zmw('100.00') },
      { accountId: ACC.capital, side: 'CR', amount: zmw('100.00') },
    ],
    ...overrides,
  };
}
```

`packages/ledger/src/books.test.ts`:
```ts
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { openBooks } from './books';
import { AccountId, PeriodId } from './ids';
import type { Company } from './model';
import { ACC, CO, OTHER_CO, demoAccounts, demoBooks, demoPeriods } from './testing/fixtures';

const company: Company = { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: ACC.rounding };

describe('openBooks', () => {
  it('opens empty books with indexed accounts', () => {
    const books = demoBooks();
    expect(books.accounts.get(ACC.cash)?.code).toBe('1000');
    expect(books.journals).toEqual([]);
    expect(books.seriesCounters.size).toBe(0);
    expect(Object.isFrozen(books)).toBe(true);
  });

  it('rejects an account from another company (§6.12)', () => {
    const foreign = { ...demoAccounts()[0]!, id: AccountId('x'), code: '9000', companyId: OTHER_CO };
    expect(errorCode(() => openBooks(company, [...demoAccounts(), foreign], demoPeriods()))).toBe('CROSS_TENANT');
  });

  it('rejects duplicate account codes', () => {
    const dup = { ...demoAccounts()[0]!, id: AccountId('x') };
    expect(errorCode(() => openBooks(company, [...demoAccounts(), dup], demoPeriods()))).toBe('DUPLICATE_ACCOUNT_CODE');
  });

  it('requires the rounding account to exist (§6.10)', () => {
    const accounts = demoAccounts().filter((a) => a.id !== ACC.rounding);
    expect(errorCode(() => openBooks(company, accounts, demoPeriods()))).toBe('NO_ROUNDING_ACCOUNT');
  });

  it.each([
    ['overlapping', [
      { id: PeriodId('p1'), companyId: CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' as const },
      { id: PeriodId('p2'), companyId: CO, start: '2026-10-31', end: '2026-11-30', status: 'OPEN' as const },
    ]],
    ['inverted', [{ id: PeriodId('p1'), companyId: CO, start: '2026-10-31', end: '2026-10-01', status: 'OPEN' as const }]],
    ['bad date', [{ id: PeriodId('p1'), companyId: CO, start: '2026-02-30', end: '2026-03-31', status: 'OPEN' as const }]],
    ['foreign', [{ id: PeriodId('p1'), companyId: OTHER_CO, start: '2026-10-01', end: '2026-10-31', status: 'OPEN' as const }]],
  ])('rejects %s periods', (_name, periods) => {
    expect(errorCode(() => openBooks(company, demoAccounts(), periods))).toBe('INVALID_PERIODS');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/ledger test`
Expected: FAIL with `Cannot find module './books'`.
```bash
git add packages/ledger/src && git commit -m "test(ledger): domain model, fixtures and failing openBooks tests"
```

- [ ] **Step 4: Implement `books.ts`**

```ts
import { isIsoDate } from '@zambooks/shared';
import { LedgerError } from './errors';
import type { AccountId } from './ids';
import type { Account, Company, CompanyBooks, Period } from './model';

export function openBooks(company: Company, accounts: readonly Account[], periods: readonly Period[]): CompanyBooks {
  const byId = new Map<AccountId, Account>();
  const codes = new Set<string>();
  for (const a of accounts) {
    if (a.companyId !== company.id) throw new LedgerError('CROSS_TENANT', `Account ${a.id} belongs to another company`);
    if (codes.has(a.code)) throw new LedgerError('DUPLICATE_ACCOUNT_CODE', `Duplicate account code ${a.code}`);
    codes.add(a.code);
    byId.set(a.id, Object.freeze({ ...a }));
  }
  if (!byId.has(company.roundingAccountId)) {
    throw new LedgerError('NO_ROUNDING_ACCOUNT', 'Company rounding account is not in its chart of accounts');
  }
  const sorted = [...periods].sort((x, y) => x.start.localeCompare(y.start));
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    const valid =
      p.companyId === company.id && isIsoDate(p.start) && isIsoDate(p.end) && p.start <= p.end &&
      (prev === undefined || prev.end < p.start);
    if (!valid) throw new LedgerError('INVALID_PERIODS', `Period ${p.id} is invalid or overlaps another`);
  });
  return Object.freeze({
    company: Object.freeze({ ...company }),
    accounts: byId,
    periods: Object.freeze(sorted.map((p) => Object.freeze({ ...p }))),
    journals: Object.freeze([]),
    seriesCounters: new Map(),
    reversals: new Map(),
  });
}
```

`packages/ledger/src/index.ts`:
```ts
export * from './ids';
export type * from './model';
export { LedgerError, type LedgerErrorCode } from './errors';
export { openBooks } from './books';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ledger && git commit -m "feat(ledger): domain model, error codes and openBooks"
```

---

### Task 5: Journal validation, conversion and rounding (`validate.ts`)

**Agent:** **BAKE-OFF (spec §4).** The test-designer (opus) writes the tests for both T5 and T6 once and commits them red on branch `bakeoff/base`. Two authors then implement T5 and T6 in separate worktrees from that commit: `bakeoff/opus` (model opus) and `bakeoff/fable` (model fable). Each is reviewed by the other model. The orchestrator merges the branch with fewer critical+high+medium findings after fixes, ties going to fewer total findings. The winner becomes the default author for the ledger/tax class. Record the result in ADR-0004.

**Files:**
- Create: `packages/ledger/src/validate.ts`
- Test: `packages/ledger/src/validate.test.ts`

**Interfaces:**
- Consumes: `CompanyBooks`, `JournalDraft`, `PreparedLine`, `Period`, `LedgerError` (T4); `convert`, `identityRate`, `isValidRate`, `isIsoDate`, `sumMoney`, `Money` (T2/T3).
- Produces:
  - `findOpenPeriod(books: CompanyBooks, date: string): Period`, which throws `INVALID_DATE | NO_PERIOD | PERIOD_CLOSED`
  - `prepareLines(books: CompanyBooks, draft: JournalDraft): PreparedLine[]`

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/validate.test.ts`:
```ts
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { AccountId, UserId } from './ids';
import type { JournalDraft } from './model';
import { ACC, OTHER_CO, PARTY, draft, demoBooks, usd, usdZmw, zmw } from './testing/fixtures';
import { findOpenPeriod, prepareLines } from './validate';

const books = demoBooks();

describe('findOpenPeriod', () => {
  it('returns the open period containing the date, inclusive of both ends', () => {
    expect(findOpenPeriod(books, '2026-10-01').id).toBe('per-2026-10');
    expect(findOpenPeriod(books, '2026-10-31').id).toBe('per-2026-10');
  });
  it.each([
    ['2026-02-30', 'INVALID_DATE'],
    ['2027-01-05', 'NO_PERIOD'],
    ['2026-09-15', 'PERIOD_CLOSED'],
  ])('%s -> %s', (date, code) => expect(errorCode(() => findOpenPeriod(books, date))).toBe(code));
});

describe('prepareLines: functional-currency journal', () => {
  it('stamps an identity rate and equal functional amounts (§6.9)', () => {
    const lines = prepareLines(books, draft());
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({ rate: '1', rateSource: 'IDENTITY', rateDate: '2026-10-15', isRounding: false });
      expect(l.functionalAmount.equals(l.txnAmount)).toBe(true);
    }
  });

  it('carries the party on control-account lines', () => {
    const lines = prepareLines(books, draft({
      lines: [
        { accountId: ACC.ar, side: 'DR', amount: zmw('50.00'), partyId: PARTY.customer },
        { accountId: ACC.sales, side: 'CR', amount: zmw('50.00') },
      ],
    }));
    expect(lines[0]?.partyId).toBe(PARTY.customer);
    expect(lines[1]?.partyId).toBeNull();
  });
});

const line = (accountId: AccountId, side: 'DR' | 'CR', amount = zmw('10.00')) => ({ accountId, side, amount });

const rejections: Array<[string, Partial<JournalDraft>, string]> = [
  ['no author', { authorId: UserId('') }, 'MISSING_AUTHOR'],
  ['other company (§6.12)', { companyId: OTHER_CO }, 'CROSS_TENANT'],
  ['impossible date', { date: '2026-02-30' }, 'INVALID_DATE'],
  ['no period', { date: '2027-01-05' }, 'NO_PERIOD'],
  ['closed period (§6.6)', { date: '2026-09-15' }, 'PERIOD_CLOSED'],
  ['single line', { lines: [line(ACC.cash, 'DR')] }, 'EMPTY_JOURNAL'],
  ['unknown / foreign account', { lines: [line(AccountId('a-other-co'), 'DR'), line(ACC.capital, 'CR')] }, 'UNKNOWN_ACCOUNT'],
  ['inactive account', { lines: [line(ACC.dormant, 'DR'), line(ACC.capital, 'CR')] }, 'INACTIVE_ACCOUNT'],
  ['line currency differs', { lines: [line(ACC.cash, 'DR', usd('10.00')), line(ACC.capital, 'CR')] }, 'CURRENCY_MISMATCH'],
  ['zero amount', { lines: [line(ACC.cash, 'DR', zmw('0')), line(ACC.capital, 'CR', zmw('0'))] }, 'NON_POSITIVE_AMOUNT'],
  ['negative amount', { lines: [line(ACC.cash, 'DR', zmw('-10.00')), line(ACC.capital, 'CR', zmw('-10.00'))] }, 'NON_POSITIVE_AMOUNT'],
  ['AR line without party (§6.4)', { lines: [line(ACC.ar, 'DR'), line(ACC.sales, 'CR')] }, 'MISSING_PARTY'],
  ['AP line without party (§6.4)', { lines: [line(ACC.expenses, 'DR'), line(ACC.ap, 'CR')] }, 'MISSING_PARTY'],
  ['unbalanced by one ngwee (§6.1)', { lines: [line(ACC.cash, 'DR', zmw('10.01')), line(ACC.capital, 'CR')] }, 'UNBALANCED'],
  ['foreign journal without rate', { currency: 'USD', lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'MISSING_FX_RATE'],
  ['rate supplied for ZMW journal', { fxRate: usdZmw('26') }, 'BAD_FX_RATE'],
  ['rate for wrong pair', { currency: 'USD', fxRate: { ...usdZmw('26'), from: 'ZAR' }, lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['rate dated after journal', { currency: 'USD', fxRate: usdZmw('26', '2026-10-16'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['rate in exponent form', { currency: 'USD', fxRate: usdZmw('2.6e1'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
  ['zero rate', { currency: 'USD', fxRate: usdZmw('0'), lines: [line(ACC.cash, 'DR', usd('1')), line(ACC.capital, 'CR', usd('1'))] }, 'BAD_FX_RATE'],
];

describe('prepareLines: rejections', () => {
  it.each(rejections)('%s', (_name, overrides, code) => {
    expect(errorCode(() => prepareLines(books, draft(overrides)))).toBe(code);
  });
});

describe('prepareLines: foreign-currency journal (§6.9, §6.10)', () => {
  it('converts every line and stores rate, source and date', () => {
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('26.4512'),
      lines: [line(ACC.expenses, 'DR', usd('100.00')), line(ACC.cash, 'CR', usd('100.00'))],
    }));
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.txnAmount.toDecimalString()).toBe('100.00');
      expect(l.functionalAmount.toDecimalString()).toBe('2645.12');
      expect(l.functionalAmount.currency).toBe('ZMW');
      expect(l).toMatchObject({ rate: '26.4512', rateSource: 'BOZ', rateDate: '2026-10-01' });
    }
  });

  it('posts a functional rounding difference to the rounding account on the debit side', () => {
    // 0.01 USD x 0.5 -> 0.00 (half-even), twice; 0.02 USD x 0.5 -> 0.01. Debits 0.00, credits 0.01.
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [line(ACC.expenses, 'DR', usd('0.01')), line(ACC.expenses, 'DR', usd('0.01')), line(ACC.cash, 'CR', usd('0.02'))],
    }));
    const rounding = lines.at(-1);
    expect(lines).toHaveLength(4);
    expect(rounding).toMatchObject({ accountId: ACC.rounding, side: 'DR', isRounding: true, partyId: null });
    expect(rounding?.functionalAmount.toDecimalString()).toBe('0.01');
    expect(rounding?.txnAmount.isZero()).toBe(true);
    expect(rounding?.txnAmount.currency).toBe('USD');
  });

  it('posts a rounding difference on the credit side when debits exceed credits', () => {
    // 0.03 USD x 0.5 -> 0.02, twice = 0.04; 0.06 USD x 0.5 -> 0.03.
    const lines = prepareLines(books, draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [line(ACC.expenses, 'DR', usd('0.03')), line(ACC.expenses, 'DR', usd('0.03')), line(ACC.cash, 'CR', usd('0.06'))],
    }));
    expect(lines.at(-1)).toMatchObject({ accountId: ACC.rounding, side: 'CR', isRounding: true });
    expect(lines.at(-1)?.functionalAmount.toDecimalString()).toBe('0.01');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Commit them red, together with Task 6 Step 1, on `bakeoff/base`.

Run: `pnpm --filter @zambooks/ledger test validate`
Expected: FAIL with `Cannot find module './validate'`.

- [ ] **Step 3: Implement**

`packages/ledger/src/validate.ts`:
```ts
import { Money, convert, identityRate, isIsoDate, isValidRate, sumMoney, type FxRate } from '@zambooks/shared';
import { LedgerError } from './errors';
import type { CompanyBooks, JournalDraft, Period, PreparedLine, Side } from './model';

export function findOpenPeriod(books: CompanyBooks, date: string): Period {
  if (!isIsoDate(date)) throw new LedgerError('INVALID_DATE', `Not a calendar date: ${date}`);
  const period = books.periods.find((p) => p.start <= date && date <= p.end);
  if (!period) throw new LedgerError('NO_PERIOD', `No accounting period contains ${date}`);
  if (period.status === 'CLOSED') throw new LedgerError('PERIOD_CLOSED', `Period ${period.id} is closed`);
  return period;
}

function resolveRate(books: CompanyBooks, draft: JournalDraft): FxRate {
  const functional = books.company.functionalCurrency;
  const rate = draft.fxRate;
  if (draft.currency === functional) {
    if (rate) throw new LedgerError('BAD_FX_RATE', 'A functional-currency journal must not carry an FX rate');
    return identityRate(functional, draft.date);
  }
  if (!rate) throw new LedgerError('MISSING_FX_RATE', `${draft.currency} journal needs a rate to ${functional}`);
  const valid =
    rate.from === draft.currency && rate.to === functional && isValidRate(rate.rate) &&
    isIsoDate(rate.rateDate) && rate.rateDate <= draft.date;
  if (!valid) throw new LedgerError('BAD_FX_RATE', `Rate ${rate.from}->${rate.to} @ ${rate.rate} on ${rate.rateDate} is not usable`);
  return rate;
}

function sideTotal(lines: readonly PreparedLine[], side: Side, pick: (l: PreparedLine) => Money, currency: Money['currency']): Money {
  return sumMoney(lines.filter((l) => l.side === side).map(pick), currency);
}

export function prepareLines(books: CompanyBooks, draft: JournalDraft): PreparedLine[] {
  if (!draft.authorId) throw new LedgerError('MISSING_AUTHOR', 'Journal has no author');
  if (draft.companyId !== books.company.id) throw new LedgerError('CROSS_TENANT', 'Journal targets another company');
  findOpenPeriod(books, draft.date);
  if (draft.lines.length < 2) throw new LedgerError('EMPTY_JOURNAL', 'A journal needs at least two lines');

  for (const l of draft.lines) {
    const account = books.accounts.get(l.accountId);
    if (!account) throw new LedgerError('UNKNOWN_ACCOUNT', `Unknown account ${l.accountId}`);
    if (!account.active) throw new LedgerError('INACTIVE_ACCOUNT', `Account ${account.code} is inactive`);
    if (l.amount.currency !== draft.currency) throw new LedgerError('CURRENCY_MISMATCH', 'Line currency differs from journal currency');
    if (!l.amount.isPositive()) throw new LedgerError('NON_POSITIVE_AMOUNT', 'Line amounts must be positive');
    if ((account.control === 'AR' || account.control === 'AP') && !l.partyId) {
      throw new LedgerError('MISSING_PARTY', `Control account ${account.code} needs a party`);
    }
  }

  const rate = resolveRate(books, draft);
  const prepared: PreparedLine[] = draft.lines.map((l) => ({
    accountId: l.accountId,
    side: l.side,
    partyId: l.partyId ?? null,
    txnAmount: l.amount,
    rate: rate.rate,
    rateSource: rate.source,
    rateDate: rate.rateDate,
    functionalAmount: convert(l.amount, rate),
    isRounding: false,
  }));

  const txn = (l: PreparedLine) => l.txnAmount;
  if (!sideTotal(prepared, 'DR', txn, draft.currency).equals(sideTotal(prepared, 'CR', txn, draft.currency))) {
    throw new LedgerError('UNBALANCED', 'Debits do not equal credits in transaction currency');
  }

  const functional = books.company.functionalCurrency;
  const fn = (l: PreparedLine) => l.functionalAmount;
  const diff = sideTotal(prepared, 'DR', fn, functional).subtract(sideTotal(prepared, 'CR', fn, functional));
  if (!diff.isZero()) {
    prepared.push({
      accountId: books.company.roundingAccountId,
      side: diff.isPositive() ? 'CR' : 'DR',
      partyId: null,
      txnAmount: Money.zero(draft.currency),
      rate: rate.rate,
      rateSource: rate.source,
      rateDate: rate.rateDate,
      functionalAmount: diff.isPositive() ? diff : diff.negate(),
      isRounding: true,
    });
  }
  return prepared;
}
```
Each conversion error is at most half a minor unit, so the rounding line is bounded by `lines/2` minor units. The bound is structural, which is why there is no tolerance branch. The property tests in Task 13 assert it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger test validate && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit** on the author's bake-off branch

```bash
git add packages/ledger/src/validate.ts && git commit -m "feat(ledger): journal validation, FX conversion and explicit rounding line"
```

---

### Task 6: Posting engine (`commit.ts`, `post.ts`)

**Agent:** Same bake-off as Task 5. The tests are committed on `bakeoff/base` together with T5's.

**Files:**
- Create: `packages/ledger/src/commit.ts`, `post.ts`
- Test: `packages/ledger/src/post.test.ts`
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**
- Consumes: `prepareLines` (T5); model types (T4).
- Produces:
  - `interface JournalHeader { series: string; date: string; currency: CurrencyCode; memo: string; authorId: UserId; approverId: UserId | null; reversalOf: JournalId | null }`
  - `commit(books, header: JournalHeader, lines: readonly PreparedLine[], ctx: LedgerContext): PostResult`
  - `post(books: CompanyBooks, draft: JournalDraft, ctx: LedgerContext): PostResult`

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/post.test.ts`:
```ts
import { errorCode, sumMoney } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { post } from './post';
import { ACC, ALICE, CO, draft, demoBooks, testContext, usd, usdZmw } from './testing/fixtures';

describe('post', () => {
  it('numbers journals gaplessly per series (§6.7)', () => {
    const ctx = testContext();
    let books = demoBooks();
    const numbers: string[] = [];
    for (const series of ['GJ', 'GJ', 'SI', 'GJ', 'SI']) {
      const r = post(books, draft({ series }), ctx);
      books = r.books;
      numbers.push(`${r.journal.series}-${r.journal.number}`);
    }
    expect(numbers).toEqual(['GJ-1', 'GJ-2', 'SI-1', 'GJ-3', 'SI-2']);
  });

  it('a rejected post consumes no number and leaves books untouched (atomic, §6.7)', () => {
    const ctx = testContext();
    const first = post(demoBooks(), draft(), ctx).books;
    expect(errorCode(() => post(first, draft({ date: '2026-09-15' }), ctx))).toBe('PERIOD_CLOSED');
    expect(first.journals).toHaveLength(1);
    const second = post(first, draft(), ctx);
    expect(second.journal.number).toBe(2);
  });

  it('is pure: the input books are not changed', () => {
    const books = demoBooks();
    post(books, draft(), testContext());
    expect(books.journals).toHaveLength(0);
    expect(books.seriesCounters.size).toBe(0);
  });

  it('stamps every line with company, author, timestamp and line number (§6.8)', () => {
    const { journal } = post(demoBooks(), draft(), testContext());
    expect(journal).toMatchObject({ id: 'j-1', companyId: CO, authorId: ALICE, approverId: null, reversalOf: null, postedAt: '2026-10-07T09:00:00.000Z' });
    journal.lines.forEach((l, i) => {
      expect(l).toMatchObject({ lineNo: i + 1, companyId: CO, authorId: ALICE, postedAt: journal.postedAt });
      expect(typeof l.accountId).toBe('string');
    });
  });

  it('balances in transaction and functional currency (§6.1)', () => {
    const { journal } = post(demoBooks(), draft({
      currency: 'USD',
      fxRate: usdZmw('0.5'),
      lines: [
        { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
        { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
        { accountId: ACC.cash, side: 'CR', amount: usd('0.02') },
      ],
    }), testContext());
    const total = (side: 'DR' | 'CR', key: 'txnAmount' | 'functionalAmount', c: 'USD' | 'ZMW') =>
      sumMoney(journal.lines.filter((l) => l.side === side).map((l) => l[key]), c);
    expect(total('DR', 'txnAmount', 'USD').equals(total('CR', 'txnAmount', 'USD'))).toBe(true);
    expect(total('DR', 'functionalAmount', 'ZMW').equals(total('CR', 'functionalAmount', 'ZMW'))).toBe(true);
  });

  it('freezes the posted journal and its lines (§6.5)', () => {
    const { journal, books } = post(demoBooks(), draft(), testContext());
    expect(Object.isFrozen(journal)).toBe(true);
    expect(Object.isFrozen(journal.lines)).toBe(true);
    expect(Object.isFrozen(journal.lines[0])).toBe(true);
    expect(Object.isFrozen(books.journals)).toBe(true);
    expect(() => {
      (journal as { memo: string }).memo = 'edited';
    }).toThrow(TypeError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red on `bakeoff/base`**

Run: `pnpm --filter @zambooks/ledger test post`
Expected: FAIL with `Cannot find module './post'`.
```bash
git add packages/ledger/src/validate.test.ts packages/ledger/src/post.test.ts
git commit -m "test(ledger): failing tests for validation and posting (bake-off base)"
```

- [ ] **Step 3: Implement**

`packages/ledger/src/commit.ts`:
```ts
import type { CurrencyCode } from '@zambooks/shared';
import type { JournalId, UserId } from './ids';
import type { CompanyBooks, LedgerContext, PostResult, PostedJournal, PreparedLine } from './model';

export interface JournalHeader {
  readonly series: string;
  readonly date: string;
  readonly currency: CurrencyCode;
  readonly memo: string;
  readonly authorId: UserId;
  readonly approverId: UserId | null;
  readonly reversalOf: JournalId | null;
}

/** Numbers, stamps and freezes an already-validated journal and returns the next books. */
export function commit(books: CompanyBooks, header: JournalHeader, lines: readonly PreparedLine[], ctx: LedgerContext): PostResult {
  const number = (books.seriesCounters.get(header.series) ?? 0) + 1;
  const postedAt = ctx.now();
  const companyId = books.company.id;
  const journal: PostedJournal = Object.freeze({
    id: ctx.newJournalId(),
    companyId,
    ...header,
    number,
    postedAt,
    lines: Object.freeze(
      lines.map((l, i) => Object.freeze({ ...l, lineNo: i + 1, companyId, authorId: header.authorId, postedAt })),
    ),
  });
  const reversals = header.reversalOf ? new Map(books.reversals).set(header.reversalOf, journal.id) : books.reversals;
  return {
    journal,
    books: Object.freeze({
      ...books,
      journals: Object.freeze([...books.journals, journal]),
      seriesCounters: new Map(books.seriesCounters).set(header.series, number),
      reversals,
    }),
  };
}
```

`packages/ledger/src/post.ts`:
```ts
import { commit } from './commit';
import type { CompanyBooks, JournalDraft, LedgerContext, PostResult } from './model';
import { prepareLines } from './validate';

export function post(books: CompanyBooks, draft: JournalDraft, ctx: LedgerContext): PostResult {
  const lines = prepareLines(books, draft);
  return commit(
    books,
    { series: draft.series, date: draft.date, currency: draft.currency, memo: draft.memo, authorId: draft.authorId, approverId: null, reversalOf: null },
    lines,
    ctx,
  );
}
```

Append to `index.ts`:
```ts
export { findOpenPeriod, prepareLines } from './validate';
export { commit, type JournalHeader } from './commit';
export { post } from './post';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger coverage && pnpm typecheck && pnpm lint`
Expected: PASS, with 100% coverage on `validate.ts`, `commit.ts`, `post.ts` and `books.ts`.

- [ ] **Step 5: Commit, cross-review and select the bake-off winner**

```bash
git add packages/ledger && git commit -m "feat(ledger): pure posting engine with gapless numbering and frozen journals"
```
The orchestrator dispatches `ledger-reviewer` with the opposite model for each branch, runs the fix loop (≤ 3 rounds), merges the winner to `main` and writes `docs/adr/0004-ledger-author-bakeoff.md` with the finding counts.

---

### Task 7: Reversals (`reverse.ts`)

**Agent:** test-designer, then the bake-off winner as author and the other model as reviewer. Wave F, parallel with T8 and T9 in its own worktree.

**Files:**
- Create: `packages/ledger/src/reverse.ts`
- Test: `packages/ledger/src/reverse.test.ts`

**Interfaces:**
- Consumes: `commit`, `findOpenPeriod` (T5/T6).
- Produces:
  - `interface ReverseRequest { journalId: JournalId; date: string; authorId: UserId; approverId: UserId; memo?: string }`
  - `reverse(books: CompanyBooks, req: ReverseRequest, ctx: LedgerContext): PostResult`

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/reverse.test.ts`:
```ts
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { JournalId, UserId } from './ids';
import { post } from './post';
import { reverse } from './reverse';
import { ACC, ALICE, BOB, CAROL, draft, demoBooks, testContext, usd, usdZmw } from './testing/fixtures';

function posted() {
  const ctx = testContext();
  const r = post(demoBooks(), draft({
    currency: 'USD',
    fxRate: usdZmw('0.5'),
    lines: [
      { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
      { accountId: ACC.expenses, side: 'DR', amount: usd('0.01') },
      { accountId: ACC.cash, side: 'CR', amount: usd('0.02') },
    ],
  }), ctx);
  return { ctx, ...r };
}

describe('reverse (§6.5)', () => {
  it('posts a linked mirror journal with sides swapped and identical amounts and rates', () => {
    const { ctx, books, journal } = posted();
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(r.journal).toMatchObject({ reversalOf: journal.id, series: journal.series, number: 2, approverId: BOB, authorId: ALICE, date: '2026-10-20' });
    expect(r.journal.memo).toBe('Reversal of GJ-1');
    expect(r.journal.lines).toHaveLength(journal.lines.length);
    r.journal.lines.forEach((l, i) => {
      const o = journal.lines[i]!;
      expect(l.side).toBe(o.side === 'DR' ? 'CR' : 'DR');
      expect(l.functionalAmount.equals(o.functionalAmount)).toBe(true);
      expect(l.txnAmount.equals(o.txnAmount)).toBe(true);
      expect(l).toMatchObject({ accountId: o.accountId, rate: o.rate, rateSource: o.rateSource, rateDate: o.rateDate, isRounding: o.isRounding });
    });
    expect(r.books.reversals.get(journal.id)).toBe(r.journal.id);
  });

  it('leaves the original journal unchanged', () => {
    const { ctx, books, journal } = posted();
    const snapshot = JSON.stringify(journal, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(JSON.stringify(r.books.journals[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
  });

  it('uses a custom memo when given', () => {
    const { ctx, books, journal } = posted();
    expect(reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB, memo: 'Posted twice' }, ctx).journal.memo).toBe('Posted twice');
  });

  it('rejects reversing twice, or reversing a reversal', () => {
    const { ctx, books, journal } = posted();
    const r = reverse(books, { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB }, ctx);
    expect(errorCode(() => reverse(r.books, { journalId: journal.id, date: '2026-10-21', authorId: CAROL, approverId: BOB }, ctx))).toBe('ALREADY_REVERSED');
    expect(errorCode(() => reverse(r.books, { journalId: r.journal.id, date: '2026-10-21', authorId: CAROL, approverId: BOB }, ctx))).toBe('ALREADY_REVERSED');
  });

  it.each([
    ['unknown journal', { journalId: JournalId('nope') }, 'UNKNOWN_JOURNAL'],
    ['no author', { authorId: UserId('') }, 'MISSING_AUTHOR'],
    ['self-approved (§8 SoD)', { approverId: ALICE }, 'SOD_VIOLATION'],
    ['no approver (§8 SoD)', { approverId: UserId('') }, 'SOD_VIOLATION'],
    ['impossible date', { date: '2026-02-30' }, 'INVALID_DATE'],
    ['dated before the original', { date: '2026-10-14' }, 'INVALID_DATE'],
    ['into a period with no calendar', { date: '2027-01-05' }, 'NO_PERIOD'],
  ])('rejects %s', (_name, override, code) => {
    const { ctx, books, journal } = posted();
    const req = { journalId: journal.id, date: '2026-10-20', authorId: ALICE, approverId: BOB, ...override };
    expect(errorCode(() => reverse(books, req, ctx))).toBe(code);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/ledger test reverse`
Expected: FAIL with `Cannot find module './reverse'`.
```bash
git add packages/ledger/src/reverse.test.ts && git commit -m "test(ledger): failing tests for reversals"
```

- [ ] **Step 3: Implement**

`packages/ledger/src/reverse.ts`:
```ts
import { isIsoDate } from '@zambooks/shared';
import { commit } from './commit';
import { LedgerError } from './errors';
import type { JournalId, UserId } from './ids';
import type { CompanyBooks, LedgerContext, PostResult, PreparedLine } from './model';
import { findOpenPeriod } from './validate';

export interface ReverseRequest {
  readonly journalId: JournalId;
  readonly date: string;
  readonly authorId: UserId;
  /** Second person; must differ from the author (spec §8 segregation of duties). */
  readonly approverId: UserId;
  readonly memo?: string;
}

export function reverse(books: CompanyBooks, req: ReverseRequest, ctx: LedgerContext): PostResult {
  const original = books.journals.find((j) => j.id === req.journalId);
  if (!original) throw new LedgerError('UNKNOWN_JOURNAL', `No journal ${req.journalId}`);
  if (books.reversals.has(original.id) || original.reversalOf !== null) {
    throw new LedgerError('ALREADY_REVERSED', 'Journal is already reversed or is itself a reversal');
  }
  if (!req.authorId) throw new LedgerError('MISSING_AUTHOR', 'Reversal has no author');
  if (!req.approverId || req.approverId === req.authorId) {
    throw new LedgerError('SOD_VIOLATION', 'A reversal needs a second approver');
  }
  if (!isIsoDate(req.date) || req.date < original.date) {
    throw new LedgerError('INVALID_DATE', 'Reversal date must be a real date on or after the original');
  }
  findOpenPeriod(books, req.date);
  const lines: PreparedLine[] = original.lines.map((l) => ({
    accountId: l.accountId,
    side: l.side === 'DR' ? 'CR' : 'DR',
    partyId: l.partyId,
    txnAmount: l.txnAmount,
    rate: l.rate,
    rateSource: l.rateSource,
    rateDate: l.rateDate,
    functionalAmount: l.functionalAmount,
    isRounding: l.isRounding,
  }));
  return commit(
    books,
    {
      series: original.series,
      date: req.date,
      currency: original.currency,
      memo: req.memo ?? `Reversal of ${original.series}-${original.number}`,
      authorId: req.authorId,
      approverId: req.approverId,
      reversalOf: original.id,
    },
    lines,
    ctx,
  );
}
```
The orchestrator adds `export { reverse, type ReverseRequest } from './reverse';` to `index.ts` at merge.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger coverage && pnpm lint`
Expected: PASS, with `reverse.ts` at 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/reverse.ts && git commit -m "feat(ledger): linked reversal journals with second-approver check"
```

---

### Task 8: Period close and reopen (`periods.ts`)

**Agent:** test-designer, then the bake-off winner as author and the other model as reviewer. Wave F, parallel.

**Files:**
- Create: `packages/ledger/src/periods.ts`
- Test: `packages/ledger/src/periods.test.ts`

**Interfaces:**
- Produces:
  - `PERIOD_ADMIN = 'PERIOD_ADMIN'`
  - `interface PeriodChange { books: CompanyBooks; audit: AuditEvent }`
  - `closePeriod(books, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange`
  - `reopenPeriod(books, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange`, which requires `PERIOD_ADMIN` (§6.6)

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/periods.test.ts`:
```ts
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import { PeriodId } from './ids';
import { PERIOD_ADMIN, closePeriod, reopenPeriod } from './periods';
import { post } from './post';
import { ALICE, BOB, CO, PERIOD, draft, demoBooks, testContext } from './testing/fixtures';

const NOW = '2026-11-02T08:00:00.000Z';
const clerk = { id: ALICE, roles: ['ACCOUNTANT'] };
const admin = { id: BOB, roles: [PERIOD_ADMIN] };

describe('closePeriod', () => {
  it('closes an open period, emits an audit event, and blocks posting (§6.6)', () => {
    const { books, audit } = closePeriod(demoBooks(), PERIOD.oct, clerk, 'October month-end', NOW);
    expect(books.periods.find((p) => p.id === PERIOD.oct)?.status).toBe('CLOSED');
    expect(audit).toEqual({ type: 'PERIOD_CLOSED', companyId: CO, periodId: PERIOD.oct, actorId: ALICE, reason: 'October month-end', at: NOW });
    expect(errorCode(() => post(books, draft(), testContext()))).toBe('PERIOD_CLOSED');
  });

  it('does not mutate the input books', () => {
    const before = demoBooks();
    closePeriod(before, PERIOD.oct, clerk, 'x', NOW);
    expect(before.periods.find((p) => p.id === PERIOD.oct)?.status).toBe('OPEN');
  });

  it.each([
    ['unknown period', PeriodId('nope'), 'x', 'UNKNOWN_PERIOD'],
    ['already closed', PERIOD.sep, 'x', 'PERIOD_STATE'],
    ['blank reason', PERIOD.oct, '  ', 'REASON_REQUIRED'],
  ])('rejects %s', (_n, id, reason, code) => {
    expect(errorCode(() => closePeriod(demoBooks(), id, clerk, reason, NOW))).toBe(code);
  });
});

describe('reopenPeriod', () => {
  it('requires the PERIOD_ADMIN role (§6.6)', () => {
    expect(errorCode(() => reopenPeriod(demoBooks(), PERIOD.sep, clerk, 'Late supplier invoice', NOW))).toBe('FORBIDDEN');
  });

  it('reopens with an audit event and allows posting again', () => {
    const { books, audit } = reopenPeriod(demoBooks(), PERIOD.sep, admin, 'Late supplier invoice', NOW);
    expect(audit).toMatchObject({ type: 'PERIOD_REOPENED', periodId: PERIOD.sep, actorId: BOB, reason: 'Late supplier invoice' });
    expect(post(books, draft({ date: '2026-09-15' }), testContext()).journal.date).toBe('2026-09-15');
  });

  it.each([
    ['already open', PERIOD.oct, 'x', 'PERIOD_STATE'],
    ['blank reason', PERIOD.sep, '', 'REASON_REQUIRED'],
  ])('rejects %s', (_n, id, reason, code) => {
    expect(errorCode(() => reopenPeriod(demoBooks(), id, admin, reason, NOW))).toBe(code);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/ledger test periods`
Expected: FAIL with `Cannot find module './periods'`.
```bash
git add packages/ledger/src/periods.test.ts && git commit -m "test(ledger): failing tests for period close/reopen"
```

- [ ] **Step 3: Implement**

`packages/ledger/src/periods.ts`:
```ts
import { LedgerError } from './errors';
import type { PeriodId } from './ids';
import type { Actor, AuditEvent, CompanyBooks, PeriodStatus } from './model';

export const PERIOD_ADMIN = 'PERIOD_ADMIN';

export interface PeriodChange {
  readonly books: CompanyBooks;
  readonly audit: AuditEvent;
}

function transition(
  books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string,
  from: PeriodStatus, to: PeriodStatus, type: AuditEvent['type'],
): PeriodChange {
  const period = books.periods.find((p) => p.id === periodId);
  if (!period) throw new LedgerError('UNKNOWN_PERIOD', `No period ${periodId}`);
  if (period.status !== from) throw new LedgerError('PERIOD_STATE', `Period ${periodId} is already ${period.status}`);
  if (!reason.trim()) throw new LedgerError('REASON_REQUIRED', 'A reason is required');
  const periods = Object.freeze(books.periods.map((p) => (p.id === periodId ? Object.freeze({ ...p, status: to }) : p)));
  const audit: AuditEvent = Object.freeze({ type, companyId: books.company.id, periodId, actorId: actor.id, reason, at: now });
  return { books: Object.freeze({ ...books, periods }), audit };
}

export function closePeriod(books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange {
  return transition(books, periodId, actor, reason, now, 'OPEN', 'CLOSED', 'PERIOD_CLOSED');
}

export function reopenPeriod(books: CompanyBooks, periodId: PeriodId, actor: Actor, reason: string, now: string): PeriodChange {
  if (!actor.roles.includes(PERIOD_ADMIN)) throw new LedgerError('FORBIDDEN', 'Reopening a period needs PERIOD_ADMIN');
  return transition(books, periodId, actor, reason, now, 'CLOSED', 'OPEN', 'PERIOD_REOPENED');
}
```
At merge, the orchestrator adds `export { PERIOD_ADMIN, closePeriod, reopenPeriod, type PeriodChange } from './periods';` to `index.ts`. Plan 03 persists `AuditEvent` into the hash-chained log.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger coverage && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/periods.ts && git commit -m "feat(ledger): period close/reopen with role check and audit events"
```

---

### Task 9: Zambian SME chart-of-accounts template (`coa.ts`)

**Agent:** The test-designer writes the tests. **Haiku** drafts the JSON data and **Sonnet** writes `coa.ts`. The reviewer is opus. The template is `VERIFY` until the accountant signs it off (register ZM-0001). Wave F, parallel.

**Files:**
- Create: `packages/ledger/templates/zm-sme-default.json`, `packages/ledger/src/coa.ts`
- Test: `packages/ledger/src/coa.test.ts`

**Interfaces:**
- Consumes: `openBooks` (T4), `LedgerError`.
- Produces: `instantiateTemplate(raw: unknown, companyId: CompanyId, newAccountId: (code: string) => AccountId): { accounts: Account[]; roundingAccountId: AccountId; ifrsSmeMapping: ReadonlyMap<AccountId, string>; status: 'VERIFY' | 'VERIFIED'; registerRef: string }`

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/coa.test.ts`:
```ts
import { errorCode } from '@zambooks/shared';
import { describe, expect, it } from 'vitest';
import template from '../templates/zm-sme-default.json';
import { openBooks } from './books';
import { instantiateTemplate } from './coa';
import { AccountId } from './ids';
import { CO } from './testing/fixtures';

const id = (code: string) => AccountId(`acc-${code}`);

describe('zm-sme-default template', () => {
  const result = instantiateTemplate(template, CO, id);

  it('is marked VERIFY with a register reference (§0.5, §10)', () => {
    expect(result.status).toBe('VERIFY');
    expect(result.registerRef).toBe('ZM-0001');
  });

  it('has exactly one AR, one AP and one inventory control account', () => {
    for (const kind of ['AR', 'AP', 'INVENTORY'] as const) {
      expect(result.accounts.filter((a) => a.control === kind)).toHaveLength(1);
    }
  });

  it('maps every account to an IFRS for SMEs line', () => {
    for (const a of result.accounts) expect(result.ifrsSmeMapping.get(a.id)).toMatch(/^(SFP|SCI): /);
  });

  it('opens valid books for the company', () => {
    const books = openBooks(
      { id: CO, name: 'Demo', functionalCurrency: 'ZMW', roundingAccountId: result.roundingAccountId },
      result.accounts,
      [],
    );
    expect(books.accounts.size).toBe(result.accounts.length);
    expect(result.accounts.every((a) => a.companyId === CO && a.active)).toBe(true);
  });
});

describe('instantiateTemplate rejects bad templates', () => {
  const base = structuredClone(template);
  it.each([
    ['not an object', 42],
    ['bad status', { ...base, status: 'APPROVED' }],
    ['bad register ref', { ...base, registerRef: 'X-1' }],
    ['duplicate codes', { ...base, accounts: [...base.accounts, base.accounts[0]] }],
    ['missing rounding account', { ...base, roundingAccountCode: '0000' }],
    ['bad account type', { ...base, accounts: [{ ...base.accounts[0], type: 'REVENUE' }] }],
  ])('%s', (_n, raw) => {
    expect(errorCode(() => instantiateTemplate(raw, CO, id))).toBe('INVALID_TEMPLATE');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/ledger test coa`
Expected: FAIL with `Cannot find module '../templates/zm-sme-default.json'`.
```bash
git add packages/ledger/src/coa.test.ts && git commit -m "test(ledger): failing tests for CoA template"
```

- [ ] **Step 3: Write the template data**

`packages/ledger/templates/zm-sme-default.json`:
```json
{
  "templateId": "zm-sme-default",
  "version": "2026.1",
  "status": "VERIFY",
  "registerRef": "ZM-0001",
  "roundingAccountCode": "8999",
  "accounts": [
    { "code": "1000", "name": "Cash on hand", "type": "ASSET", "control": null, "ifrsSme": "SFP: Cash and cash equivalents" },
    { "code": "1010", "name": "Bank - ZMW current account", "type": "ASSET", "control": null, "ifrsSme": "SFP: Cash and cash equivalents" },
    { "code": "1020", "name": "Bank - USD account", "type": "ASSET", "control": null, "ifrsSme": "SFP: Cash and cash equivalents" },
    { "code": "1030", "name": "Mobile money - MTN", "type": "ASSET", "control": null, "ifrsSme": "SFP: Cash and cash equivalents" },
    { "code": "1031", "name": "Mobile money - Airtel", "type": "ASSET", "control": null, "ifrsSme": "SFP: Cash and cash equivalents" },
    { "code": "1200", "name": "Trade receivables", "type": "ASSET", "control": "AR", "ifrsSme": "SFP: Trade and other receivables" },
    { "code": "1210", "name": "Allowance for credit losses", "type": "ASSET", "control": null, "ifrsSme": "SFP: Trade and other receivables" },
    { "code": "1250", "name": "VAT input (recoverable)", "type": "ASSET", "control": null, "ifrsSme": "SFP: Trade and other receivables" },
    { "code": "1260", "name": "Prepayments", "type": "ASSET", "control": null, "ifrsSme": "SFP: Trade and other receivables" },
    { "code": "1300", "name": "Inventory", "type": "ASSET", "control": "INVENTORY", "ifrsSme": "SFP: Inventories" },
    { "code": "1500", "name": "Property, plant and equipment - cost", "type": "ASSET", "control": null, "ifrsSme": "SFP: Property, plant and equipment" },
    { "code": "1510", "name": "Property, plant and equipment - accumulated depreciation", "type": "ASSET", "control": null, "ifrsSme": "SFP: Property, plant and equipment" },
    { "code": "2000", "name": "Trade payables", "type": "LIABILITY", "control": "AP", "ifrsSme": "SFP: Trade and other payables" },
    { "code": "2100", "name": "VAT output", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Current tax liabilities" },
    { "code": "2110", "name": "PAYE payable", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Trade and other payables" },
    { "code": "2120", "name": "NAPSA payable", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Trade and other payables" },
    { "code": "2130", "name": "NHIMA payable", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Trade and other payables" },
    { "code": "2140", "name": "Withholding tax payable", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Current tax liabilities" },
    { "code": "2200", "name": "Accruals", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Trade and other payables" },
    { "code": "2500", "name": "Bank loans", "type": "LIABILITY", "control": null, "ifrsSme": "SFP: Borrowings" },
    { "code": "3000", "name": "Share capital", "type": "EQUITY", "control": null, "ifrsSme": "SFP: Share capital" },
    { "code": "3100", "name": "Retained earnings", "type": "EQUITY", "control": null, "ifrsSme": "SFP: Retained earnings" },
    { "code": "4000", "name": "Sales - goods", "type": "INCOME", "control": null, "ifrsSme": "SCI: Revenue" },
    { "code": "4100", "name": "Sales - services", "type": "INCOME", "control": null, "ifrsSme": "SCI: Revenue" },
    { "code": "4900", "name": "Other income", "type": "INCOME", "control": null, "ifrsSme": "SCI: Other income" },
    { "code": "5000", "name": "Cost of sales", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Cost of sales" },
    { "code": "6000", "name": "Salaries and wages", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Employee benefits expense" },
    { "code": "6100", "name": "Rent", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Other expenses" },
    { "code": "6200", "name": "Depreciation", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Depreciation and amortisation" },
    { "code": "6300", "name": "Bank and mobile money charges", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Other expenses" },
    { "code": "7000", "name": "Finance costs", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Finance costs" },
    { "code": "8900", "name": "Foreign exchange gains and losses", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Other gains and losses" },
    { "code": "8999", "name": "FX rounding differences", "type": "EXPENSE", "control": null, "ifrsSme": "SCI: Other gains and losses" }
  ]
}
```
The accountant must review this before production use (register ZM-0001). Contra accounts (1210, 1510) are typed ASSET and carry credit balances. ADR-0003 records this choice.

- [ ] **Step 4: Implement `coa.ts`**

```ts
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
```
At merge, the orchestrator adds `export { instantiateTemplate, type InstantiatedTemplate } from './coa';` to `index.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger coverage && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ledger/templates packages/ledger/src/coa.ts && git commit -m "feat(ledger): Zambian SME default CoA template (VERIFY, ZM-0001)"
```

---

### Task 10: Claude Code agents, commands and hooks (`.claude/`)

**Agent:** sonnet author, opus reviewer. Wave B, parallel with T2 and T11.

**Files:**
- Create: `.claude/agents/{ledger-reviewer,tax-auditor,security-reviewer,test-designer,data-migrator}.md`
- Create: `.claude/commands/{zb-plan,invariants,xreview,compliance-check,release-gate}.md`
- Create: `.claude/hooks/{protect-paths,post-edit-check,stop-gate,test-hooks}.sh`, `.claude/settings.json`

**Interfaces:**
- Produces: the subagent names used by the orchestrator, and the hook contract. Write a register ID such as `ZM-0004` to the git-ignored `.claude/active-register-ref` to unlock edits to `packages/tax-zm/rates/**` and `migrations/applied/**`.
- Commands are named `/zb-plan` and `/xreview` because `/plan` and `/review` collide with existing commands and skills in this environment.

- [ ] **Step 1: Write the failing hook test**

`.claude/hooks/test-hooks.sh`:
```bash
#!/usr/bin/env bash
# Exercises protect-paths.sh with synthetic PreToolUse payloads.
set -uo pipefail
export CLAUDE_PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
hook="$CLAUDE_PROJECT_DIR/.claude/hooks/protect-paths.sh"
ref="$CLAUDE_PROJECT_DIR/.claude/active-register-ref"
fail=0
expect() { # expect <exit-code> <file_path> <label>
  printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$2" | "$hook" >/dev/null 2>&1
  local got=$?
  if [[ $got -ne $1 ]]; then echo "FAIL: $3 (expected $1, got $got)"; fail=1; else echo "ok: $3"; fi
}
rm -f "$ref"
expect 0 "$CLAUDE_PROJECT_DIR/packages/ledger/src/post.ts" "ordinary file allowed"
expect 2 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates blocked without ref"
expect 2 "$CLAUDE_PROJECT_DIR/migrations/applied/0001.sql" "applied migration blocked without ref"
echo "ZM-9999" > "$ref"
expect 2 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates blocked with unknown ref"
echo "ZM-0001" > "$ref"
expect 0 "$CLAUDE_PROJECT_DIR/packages/tax-zm/rates/vat.json" "rates allowed with registered ref"
rm -f "$ref"
exit $fail
```
Run: `chmod +x .claude/hooks/*.sh && .claude/hooks/test-hooks.sh`
Expected: FAIL, because `protect-paths.sh` does not exist yet. The `ZM-0001` case passes only once Task 11's register exists, so run the final check after T11 merges.

- [ ] **Step 2: Write the hooks**

`.claude/hooks/protect-paths.sh`:
```bash
#!/usr/bin/env bash
# PreToolUse: block edits to applied migrations and statutory rate data unless an active register entry is declared (spec §5).
set -euo pipefail
path="$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
case "$path" in
  */migrations/applied/*|*/packages/tax-zm/rates/*)
    ref_file="$CLAUDE_PROJECT_DIR/.claude/active-register-ref"
    register="$CLAUDE_PROJECT_DIR/docs/compliance/register.md"
    if [[ -f "$ref_file" && -f "$register" ]]; then
      ref="$(tr -d '[:space:]' < "$ref_file")"
      if [[ "$ref" =~ ^ZM-[0-9]{4}$ ]] && grep -q "^| $ref |" "$register"; then exit 0; fi
    fi
    echo "Blocked: $path is protected (spec §5). Add or cite a docs/compliance/register.md entry and write its ID to .claude/active-register-ref." >&2
    exit 2 ;;
esac
exit 0
```

`.claude/hooks/post-edit-check.sh`:
```bash
#!/usr/bin/env bash
# PostToolUse: lint the edited TS file and typecheck the workspace; exit 2 feeds errors back to Claude.
set -uo pipefail
path="$(jq -r '.tool_input.file_path // empty')"
[[ "$path" == *.ts || "$path" == *.tsx ]] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out="$(pnpm -s exec eslint "$path" 2>&1 && pnpm -s typecheck 2>&1)"; then
  echo "$out" | tail -40 >&2
  exit 2
fi
```

`.claude/hooks/stop-gate.sh`:
```bash
#!/usr/bin/env bash
# Stop: refuse to finish while the unit or invariant suite is red (spec §5).
set -uo pipefail
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out="$(pnpm -s test 2>&1 && pnpm -s test:invariants 2>&1)"; then
  echo "Refusing to finish: unit/invariant suite is red. Fix it or report the failure to the user." >&2
  echo "$out" | tail -60 >&2
  exit 2
fi
```

`.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-paths.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/post-edit-check.sh", "timeout": 180 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/stop-gate.sh", "timeout": 600 }] }
    ]
  }
}
```
Known limits:
- The PreToolUse hook does not cover writes made through Bash. The `ledger-reviewer` and `tax-auditor` prompts therefore also check diffs to protected paths.
- Stop fires in the main checkout only, where `main` is always green. Red test commits live on worktree branches and subagents, so they do not trip it.

- [ ] **Step 3: Write the subagents.** Each file has YAML frontmatter followed by its system prompt.

`.claude/agents/ledger-reviewer.md`:
```markdown
---
name: ledger-reviewer
description: Reviews any diff touching packages/ledger, packages/shared money/FX, or posting paths against CLAUDE.md §6 ledger invariants. Use after every ledger task, with a model different from the author's.
tools: Read, Grep, Glob, Bash
model: fable
---
You review diffs for ZamBooks, a double-entry accounting system. You never edit files; you return findings.

Inputs you will be given: the task text, and a git range. Run `git diff <range>` and read CLAUDE.md §6 and §8.

For each of §6 invariants 1–12, decide: upheld / violated / not touched. For each violation, return:
- severity (critical | high | medium | low)
- file:line
- the invariant number
- a concrete failure scenario (inputs → wrong state)

Also flag:
- any `number`/float arithmetic on money
- any mutation of posted journals or input books
- `Date.now()` or randomness inside packages/ledger
- edits to `*.test.ts` files by the implementation author
- unreachable branches added only for "safety"

Be sceptical. Verify claims by running `pnpm --filter @zambooks/ledger test` and `pnpm test:invariants`. Report the exact output on failure. Do not report style nits as medium or higher.
```

`.claude/agents/tax-auditor.md`:
```markdown
---
name: tax-auditor
description: Checks Zambian tax logic and rate data against docs/compliance/register.md. Refuses any rate, threshold or rule without a register entry. Use on every diff touching packages/tax-zm or payroll.
tools: Read, Grep, Glob, Bash
model: opus
---
You audit tax logic for ZamBooks (Zambia).

Rules:
1. Every rate, threshold, band, due date or statutory rule in the diff must trace to a register entry (ZM-NNNN) in docs/compliance/register.md. The entry must have a source citation and an effective date.
2. Values must live in packages/tax-zm/rates/*.json, versioned by effective date, never as code literals.
3. A register entry whose status is VERIFY must not be enabled for production use. Check for a feature flag or guard.
4. You may propose new VERIFY entries. You must never mark an entry VERIFIED or suggest that anyone other than a named human accountant may do so.
5. Do not rely on your own memory of Zambian rates. If the diff's value differs from the cited source, or the source is missing, report it as high severity.

Return findings in this shape: severity, file:line, register ID, issue, scenario.
```

`.claude/agents/security-reviewer.md`:
```markdown
---
name: security-reviewer
description: Runs the CLAUDE.md §8 security and privacy checklist and threat-models new endpoints or integrations. Use on every diff touching auth, tenancy, data access, import/export, or external APIs.
tools: Read, Grep, Glob, Bash
model: fable
---
You are the security reviewer for ZamBooks, a multi-tenant accounting SaaS holding financial data and PII for Zambian SMEs. This is defensive review of our own code.

Walk the §8 checklist item by item against the diff and mark each item pass / fail / n/a with evidence (file:line):
- RLS
- SoD
- MFA
- Zod validation
- parameterised SQL
- CSV formula injection on import AND export
- secrets
- encryption
- PII and amounts in logs
- audit log append-only and hash-chain
- Data Protection Act 2021

For each new endpoint or integration, write a short STRIDE threat model. Every cross-tenant path must have a test that attempts the access and asserts denial. If any is missing, report it as a high finding.

Return findings with severity, file:line, checklist item, and an exploit scenario described at the class level.
```

`.claude/agents/test-designer.md`:
```markdown
---
name: test-designer
description: Writes failing unit, edge-case and fast-check property tests from the plan/spec BEFORE implementation, and commits them red. Never writes implementation code.
tools: Read, Grep, Glob, Bash, Write, Edit
model: opus
---
You write tests first for ZamBooks.

Inputs: a task from docs/superpowers/plans/*.md and the spec (CLAUDE.md).

1. Write the test files named in the task. You may also write type-only modules and test fixtures if the task assigns them to you.
2. Cover the following:
   - the happy path
   - every error code the task lists
   - the plan's Review Focus items that the task owns
   - boundaries: zero, one minor unit, period edges, values above 2^53
3. For invariants, use fast-check with numRuns >= 2000. Generate amounts as bigint and rates as decimal strings, never floats.
4. Run the tests and confirm they fail for the expected reason (missing module or symbol), not because of a syntax or type error in the test.
5. Commit with `test(<pkg>): failing tests for <thing>`.
6. Report the exact failing output.

Never write implementation code. Never weaken an assertion to make a future implementation easier.
```

`.claude/agents/data-migrator.md`:
```markdown
---
name: data-migrator
description: Owns CSV/XLSX import mappings and database migration scripts (Drizzle + SQL). Use for plan 02 migrations and plan 09 importers.
tools: Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---
You own imports and migrations for ZamBooks.

Migrations:
- Every migration has an up and a down.
- Every migration is tested up → down → up on Testcontainers Postgres 16.
- Never edit files under migrations/applied/. Create a new migration instead.
- Money columns are NUMERIC(19,4) or BIGINT minor units, never float or real.
- Every tenant table has company_id and an RLS policy, plus a test that a different tenant cannot read or write it.

Imports:
- Use the flow preview → column mapping → dry-run → error report → commit, and roll back the whole batch on failure.
- Enforce size limits, row caps, MIME and content sniffing.
- Neutralise CSV formula injection (leading = + - @ tab CR) on import and export.
- Never log row contents or amounts.
```

- [ ] **Step 4: Write the slash commands**

`.claude/commands/invariants.md`:
```markdown
---
description: Run the §6 ledger invariant suite and report results verbatim
---
Run `pnpm test:invariants` and `pnpm --filter @zambooks/ledger coverage`. Report pass/fail per invariant test file with the exact failing output. Do not summarise failures as passes.
```
`.claude/commands/zb-plan.md`:
```markdown
---
description: Write a short task plan per CLAUDE.md §3 step 2
argument-hint: <task>
---
For task "$ARGUMENTS", read CLAUDE.md, docs/adr/, and the existing tests. Write a plan of 15 lines or fewer covering:
- scope
- §6 invariants affected
- files touched
- risks
- the model class (Opus, Sonnet or Haiku per §4)
- which subagents review it

Stop and ask if a statutory rule is involved that has no register entry.
```
`.claude/commands/xreview.md`:
```markdown
---
description: Cross-model review of the current branch against §6 and §8
argument-hint: <author-model: opus|fable|sonnet|haiku>
---
The author model was $ARGUMENTS. Dispatch `ledger-reviewer` (and `security-reviewer` if auth/data/API files changed, and `tax-auditor` if packages/tax-zm changed) using a model different from the author on `git diff main...HEAD`. Collate findings by severity. Critical/high block merge.
```
`.claude/commands/compliance-check.md`:
```markdown
---
description: Lint the compliance register and list unverified statutory values
---
Run `pnpm check:register`. Then list every register entry whose status is VERIFY, with its implementation location, and every value under packages/tax-zm/rates/ that has no register entry. Never change a status.
```
`.claude/commands/release-gate.md`:
```markdown
---
description: Report status of the CLAUDE.md §12 human release gates
---
For each of the eight §12 gates, report: evidence found in the repo (file/commit), or "NOT MET — needs <named human>". Never mark a human-signoff gate as met based on AI review. Run the full CI command set and include its real output.
```

- [ ] **Step 5: Run the hook tests.** Run them after T11 has produced `docs/compliance/register.md`.

Run: `.claude/hooks/test-hooks.sh`
Expected: five `ok:` lines and exit 0.

- [ ] **Step 6: Commit**

```bash
git add .claude && git commit -m "chore(claude): subagents, slash commands and guard hooks per spec §5"
```

---

### Task 11: Spec, ADRs, compliance register and register linter

**Agent:** haiku author for the docs; the test-designer writes `check-register.test.mjs`; opus reviewer. Wave B, parallel with T2 and T10.

**Files:**
- Create: `CLAUDE.md`, a copy of `md files/ZamBooks working.md` (keep the original in place)
- Create: `CHANGELOG.md`, `docs/adr/0000-template.md`, `docs/adr/0001-record-architecture-decisions.md`, `docs/adr/0002-backend-and-orm.md`, `docs/adr/0003-money-representation.md`
- Create: `docs/compliance/register.md`
- Create: `scripts/check-register.mjs`
- Test: `scripts/check-register.test.mjs`

**Interfaces:**
- Produces:
  - register rows `| ZM-NNNN | rule | source | effective | implementation | test | verified_by | status |`
  - `checkRegister(markdown: string): string[]`, which returns a list of errors

- [ ] **Step 1: Write the failing linter test**

`scripts/check-register.test.mjs`:
```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRegister } from './check-register.mjs';

const row = (cells) => `| ${cells.join(' | ')} |`;
const ok = ['ZM-0001', 'Rule', 'Source', '2026-01-01', 'impl.ts', 'impl.test.ts', '', 'VERIFY'];

test('accepts a well-formed VERIFY row', () => {
  assert.deepEqual(checkRegister(row(ok)), []);
});

test('accepts VERIFIED with a human name, qualification and date', () => {
  const r = [...ok]; r[6] = 'Jane Banda, ZICA FCA, 2026-11-01'; r[7] = 'VERIFIED';
  assert.deepEqual(checkRegister(row(r)), []);
});

test('rejects VERIFIED without a proper verified_by', () => {
  const r = [...ok]; r[7] = 'VERIFIED';
  assert.match(checkRegister(row(r)).join(), /verified_by/);
});

test('rejects VERIFIED by an AI', () => {
  const r = [...ok]; r[6] = 'Claude, AI reviewer, 2026-11-01'; r[7] = 'VERIFIED';
  assert.match(checkRegister(row(r)).join(), /human/);
});

test('rejects unknown status, missing source, wrong column count and duplicates', () => {
  const bad = [...ok]; bad[7] = 'APPROVED';
  const noSource = [...ok]; noSource[2] = '';
  const errs = checkRegister([row(bad), row(noSource), '| ZM-0002 | too | few |', row(ok), row(ok)].join('\n'));
  assert.match(errs.join('\n'), /status/);
  assert.match(errs.join('\n'), /source/);
  assert.match(errs.join('\n'), /8 columns/);
  assert.match(errs.join('\n'), /duplicate/);
});
```
Run: `node --test scripts/*.test.mjs`
Expected: FAIL with `Cannot find module ... check-register.mjs`. Commit it red.

- [ ] **Step 2: Implement the linter**

`scripts/check-register.mjs`:
```js
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkRegister(markdown) {
  const errors = [];
  const seen = new Set();
  for (const line of markdown.split('\n').filter((l) => /^\|\s*ZM-/.test(l))) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 8) {
      errors.push(`${line}: expected 8 columns, got ${cells.length}`);
      continue;
    }
    const [id, rule, source, , , , verifiedBy, status] = cells;
    if (!/^ZM-\d{4}$/.test(id)) errors.push(`${id}: id must be ZM-NNNN`);
    if (seen.has(id)) errors.push(`${id}: duplicate id`);
    seen.add(id);
    if (!rule) errors.push(`${id}: rule is required`);
    if (!source) errors.push(`${id}: source is required`);
    if (status !== 'VERIFY' && status !== 'VERIFIED') errors.push(`${id}: status must be VERIFY or VERIFIED`);
    if (status === 'VERIFIED') {
      if (!/^[^,]+,[^,]+,\s*\d{4}-\d{2}-\d{2}$/.test(verifiedBy)) {
        errors.push(`${id}: VERIFIED needs verified_by "name, qualification, YYYY-MM-DD"`);
      } else if (/\b(claude|ai|llm|gpt|model)\b/i.test(verifiedBy)) {
        errors.push(`${id}: only a human may verify (spec §10)`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkRegister(readFileSync(process.argv[2], 'utf8'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('register ok');
}
```
Run: `node --test scripts/*.test.mjs`
Expected: PASS.

- [ ] **Step 3: Write the docs**

```bash
cp "md files/ZamBooks working.md" CLAUDE.md
mkdir -p docs/adr docs/compliance
```

`docs/compliance/register.md`:
```markdown
# Compliance Register

Spec §10. Claude Code may add `VERIFY` rows; only a named human reviewer may set `VERIFIED`. Linted by `pnpm check:register`.

| ID | Rule | Source | Effective | Implementation | Test | verified_by | Status |
|---|---|---|---|---|---|---|---|
| ZM-0001 | Default Zambian SME chart of accounts and IFRS for SMEs line mapping | IFRS for SMEs Sections 4–5; accountant review pending | 2026-10-07 | packages/ledger/templates/zm-sme-default.json | packages/ledger/src/coa.test.ts |  | VERIFY |
| ZM-0002 | FX conversion rounds half-to-even to the functional currency minor unit | Internal policy proposal, ADR-0003; accountant review pending | 2026-10-07 | packages/shared/src/fx.ts | packages/shared/src/fx.test.ts |  | VERIFY |
| ZM-0003 | FX rounding differences per journal post to a designated rounding account (8999) | Spec §6.10; accountant to confirm account and presentation | 2026-10-07 | packages/ledger/src/validate.ts | packages/ledger/src/validate.test.ts |  | VERIFY |
```

`docs/adr/0000-template.md`:
```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-NNNN
- Date: YYYY-MM-DD
- Deciders: names

## Context
## Decision
## Consequences
```

`docs/adr/0001-record-architecture-decisions.md`:
```markdown
# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-10-07

## Context
Spec §2 requires a written ADR to override any stack default, and §3 step 8 requires ADRs for decisions.
## Decision
Decisions are recorded as numbered markdown files in docs/adr using 0000-template.md. Superseded ADRs are kept and linked, never deleted.
## Consequences
Every PR that makes a decision adds or updates an ADR; reviewers reject undocumented decisions.
```

`docs/adr/0002-backend-and-orm.md`:
```markdown
# ADR-0002: Backend framework and ORM

- Status: Proposed — awaiting owner confirmation before plan 02
- Date: 2026-10-07

## Context
Spec §2 permits NestJS or Fastify, and Drizzle or Prisma.
## Decision
Fastify + Zod (via fastify-type-provider-zod) for the API; Drizzle with hand-reviewed SQL migrations.
Fastify keeps the HTTP layer thin over the pure ledger; Drizzle's SQL-first migrations make RLS policies and NUMERIC/BIGINT columns explicit and reviewable.
## Consequences
No DI container; modules are plain functions. Plan 02 owns the migration tooling.
```

`docs/adr/0003-money-representation.md`:
```markdown
# ADR-0003: Money representation and rounding

- Status: Accepted (rounding mode pending accountant review, ZM-0002)
- Date: 2026-10-07

## Decision
- Amounts are `bigint` minor units in a frozen `Money` class tagged with an ISO currency. Parsing rejects excess precision rather than rounding.
- FX rates are plain decimal strings; conversion uses decimal.js (precision 50) and rounds half-to-even once, per line.
- Journal-level functional differences post to the company rounding account (spec §6.10).
- Contra accounts (allowances, accumulated depreciation) keep the type of the section they present in and carry opposite-sign balances.
- Database storage: BIGINT minor units (decided in plan 02).
## Consequences
TypeScript rejects arithmetic operators on Money; ESLint bans parseFloat and Math.round in money packages.
```

`CHANGELOG.md`:
```markdown
# Changelog

## [Unreleased]
### Added
- Monorepo scaffold, CI gates, compliance register and linter, Claude Code agents/hooks.
- `@zambooks/shared`: Money, FX conversion, ISO date check.
- `@zambooks/ledger`: domain model, posting engine, reversals, periods, CoA template, trial balance, invariant property suite.
```

- [ ] **Step 4: Verify**

Run: `pnpm check:register && node --test scripts/*.test.mjs`
Expected: `register ok`, and all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md docs scripts && git commit -m "docs: spec as CLAUDE.md, ADRs 0001-0003, compliance register and linter"
```

---

### Task 12: Trial balance, balance-sheet identity, sub-ledger reconciliation (`reports.ts`)

**Agent:** test-designer, then the bake-off winner as author and the other model as reviewer. Wave G.

**Files:**
- Create: `packages/ledger/src/reports.ts`
- Test: `packages/ledger/src/reports.test.ts`
- Modify: `packages/ledger/src/index.ts`

**Interfaces:**
- Produces:
  - `accountBalances(books, asOf: string): Map<AccountId, Money>`, signed with debits positive, in the functional currency
  - `trialBalance(books, asOf): { rows: TrialBalanceRow[]; totalDebit: Money; totalCredit: Money }`, where `TrialBalanceRow = { accountId; code; debit: Money; credit: Money }`, sorted by code with zero rows omitted
  - `balanceSheetCheck(books, asOf): { assets; liabilities; equity; unclosedEarnings: Money; holds: boolean }`
  - `subledgerBalances(books, asOf, control: 'AR' | 'AP'): { byParty: Map<PartyId, Money>; controlTotal: Money; reconciles: boolean }`

- [ ] **Step 1: Write the failing tests**

`packages/ledger/src/reports.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { CompanyBooks } from './model';
import { post } from './post';
import { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { reverse } from './reverse';
import { ACC, ALICE, BOB, PARTY, draft, demoBooks, testContext, zmw } from './testing/fixtures';

function scenario(): CompanyBooks {
  const ctx = testContext();
  let b = demoBooks();
  const steps = [
    draft({ date: '2026-10-01', lines: [{ accountId: ACC.cash, side: 'DR', amount: zmw('10000.00') }, { accountId: ACC.capital, side: 'CR', amount: zmw('10000.00') }] }),
    draft({ date: '2026-10-05', series: 'SI', lines: [{ accountId: ACC.ar, side: 'DR', amount: zmw('1160.00'), partyId: PARTY.customer }, { accountId: ACC.sales, side: 'CR', amount: zmw('1160.00') }] }),
    draft({ date: '2026-10-06', series: 'PI', lines: [{ accountId: ACC.expenses, side: 'DR', amount: zmw('300.00') }, { accountId: ACC.ap, side: 'CR', amount: zmw('300.00'), partyId: PARTY.supplier }] }),
    draft({ date: '2026-10-20', series: 'RC', lines: [{ accountId: ACC.cash, side: 'DR', amount: zmw('1000.00') }, { accountId: ACC.ar, side: 'CR', amount: zmw('1000.00'), partyId: PARTY.customer }] }),
  ];
  for (const d of steps) b = post(b, d, ctx).books;
  return b;
}

describe('reports', () => {
  it('computes signed functional balances as of a date', () => {
    const bal = accountBalances(scenario(), '2026-10-31');
    expect(bal.get(ACC.cash)?.toDecimalString()).toBe('11000.00');
    expect(bal.get(ACC.ar)?.toDecimalString()).toBe('160.00');
    expect(bal.get(ACC.sales)?.toDecimalString()).toBe('-1160.00');
    expect(accountBalances(scenario(), '2026-10-05').get(ACC.cash)?.toDecimalString()).toBe('10000.00');
  });

  it('trial balance nets to zero and omits zero rows (§6.2)', () => {
    const tb = trialBalance(scenario(), '2026-10-31');
    expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true);
    expect(tb.totalDebit.toDecimalString()).toBe('11460.00');
    expect(tb.rows.map((r) => r.code)).toEqual(['1000', '1200', '2000', '3000', '4000', '5000']);
    expect(tb.rows.find((r) => r.code === '4000')?.credit.toDecimalString()).toBe('1160.00');
    expect(trialBalance(demoBooks(), '2026-10-31').rows).toEqual([]);
  });

  it('balance sheet identity holds including unclosed earnings (§6.3)', () => {
    const bs = balanceSheetCheck(scenario(), '2026-10-31');
    expect(bs.assets.toDecimalString()).toBe('11160.00');
    expect(bs.liabilities.toDecimalString()).toBe('300.00');
    expect(bs.equity.toDecimalString()).toBe('10000.00');
    expect(bs.unclosedEarnings.toDecimalString()).toBe('860.00');
    expect(bs.holds).toBe(true);
  });

  it('AR and AP sub-ledgers reconcile to their control accounts (§6.4)', () => {
    const ar = subledgerBalances(scenario(), '2026-10-31', 'AR');
    expect(ar.byParty.get(PARTY.customer)?.toDecimalString()).toBe('160.00');
    expect(ar.controlTotal.toDecimalString()).toBe('160.00');
    expect(ar.reconciles).toBe(true);
    const ap = subledgerBalances(scenario(), '2026-10-31', 'AP');
    expect(ap.byParty.get(PARTY.supplier)?.toDecimalString()).toBe('-300.00');
    expect(ap.reconciles).toBe(true);
  });

  it('a reversed journal nets its accounts back to zero', () => {
    const ctx = testContext();
    const r = post(demoBooks(), draft(), ctx);
    const rev = reverse(r.books, { journalId: r.journal.id, date: '2026-10-16', authorId: ALICE, approverId: BOB }, ctx);
    expect(trialBalance(rev.books, '2026-10-31').rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail, then commit them red**

Run: `pnpm --filter @zambooks/ledger test reports`
Expected: FAIL with `Cannot find module './reports'`.
```bash
git add packages/ledger/src/reports.test.ts && git commit -m "test(ledger): failing tests for TB, BS identity and sub-ledger reconciliation"
```

- [ ] **Step 3: Implement**

`packages/ledger/src/reports.ts`:
```ts
import { Money, sumMoney } from '@zambooks/shared';
import type { AccountId, PartyId } from './ids';
import type { AccountType, CompanyBooks, PostedLine } from './model';

export interface TrialBalanceRow {
  readonly accountId: AccountId;
  readonly code: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface TrialBalance {
  readonly rows: TrialBalanceRow[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
}

export interface BalanceSheetCheck {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly equity: Money;
  readonly unclosedEarnings: Money;
  readonly holds: boolean;
}

export interface SubledgerBalances {
  readonly byParty: Map<PartyId, Money>;
  readonly controlTotal: Money;
  readonly reconciles: boolean;
}

const signed = (l: PostedLine): Money => (l.side === 'DR' ? l.functionalAmount : l.functionalAmount.negate());

function linesAsOf(books: CompanyBooks, asOf: string): PostedLine[] {
  return books.journals.filter((j) => j.date <= asOf).flatMap((j) => j.lines);
}

export function accountBalances(books: CompanyBooks, asOf: string): Map<AccountId, Money> {
  const zero = Money.zero(books.company.functionalCurrency);
  const out = new Map<AccountId, Money>();
  for (const l of linesAsOf(books, asOf)) out.set(l.accountId, (out.get(l.accountId) ?? zero).add(signed(l)));
  return out;
}

export function trialBalance(books: CompanyBooks, asOf: string): TrialBalance {
  const currency = books.company.functionalCurrency;
  const zero = Money.zero(currency);
  const rows = [...accountBalances(books, asOf)]
    .filter(([, bal]) => !bal.isZero())
    .map(([accountId, bal]) => ({
      accountId,
      code: books.accounts.get(accountId)?.code ?? '',
      debit: bal.isPositive() ? bal : zero,
      credit: bal.isNegative() ? bal.negate() : zero,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    rows,
    totalDebit: sumMoney(rows.map((r) => r.debit), currency),
    totalCredit: sumMoney(rows.map((r) => r.credit), currency),
  };
}

export function balanceSheetCheck(books: CompanyBooks, asOf: string): BalanceSheetCheck {
  const currency = books.company.functionalCurrency;
  const balances = accountBalances(books, asOf);
  const total = (...types: AccountType[]) =>
    sumMoney([...balances].filter(([id]) => types.includes(books.accounts.get(id)?.type as AccountType)).map(([, b]) => b), currency);
  const assets = total('ASSET');
  const liabilities = total('LIABILITY').negate();
  const equity = total('EQUITY').negate();
  const unclosedEarnings = total('INCOME', 'EXPENSE').negate();
  return { assets, liabilities, equity, unclosedEarnings, holds: assets.equals(liabilities.add(equity).add(unclosedEarnings)) };
}

export function subledgerBalances(books: CompanyBooks, asOf: string, control: 'AR' | 'AP'): SubledgerBalances {
  const zero = Money.zero(books.company.functionalCurrency);
  const byParty = new Map<PartyId, Money>();
  let controlTotal = zero;
  let partyTotal = zero;
  for (const l of linesAsOf(books, asOf)) {
    if (books.accounts.get(l.accountId)?.control !== control) continue;
    controlTotal = controlTotal.add(signed(l));
    if (l.partyId) {
      byParty.set(l.partyId, (byParty.get(l.partyId) ?? zero).add(signed(l)));
      partyTotal = partyTotal.add(signed(l));
    }
  }
  return { byParty, controlTotal, reconciles: controlTotal.equals(partyTotal) };
}
```
`?? ''` and `as AccountType` cover account IDs that `openBooks` and `prepareLines` already guarantee exist. If v8 reports an uncovered branch on them, the reviewer decides between an `/* v8 ignore next */` with a comment and a test that builds books by hand. Do not lower the threshold.

Append to `index.ts`:
```ts
export { accountBalances, balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
export type { BalanceSheetCheck, SubledgerBalances, TrialBalance, TrialBalanceRow } from './reports';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zambooks/ledger coverage && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src && git commit -m "feat(ledger): trial balance, balance-sheet identity and AR/AP reconciliation"
```

---

### Task 13: Property-based invariant suite (fast-check)

**Agent:** **test-designer (opus) is the author of record.** This task is all tests, and the implementation already exists. The reviewer is fable. Any property failure is a ledger bug: stop and send it back to the owning task's author. **Never loosen a property.** Wave H.

**Files:**
- Create: `packages/ledger/src/testing/arbitraries.ts`
- Test: `packages/ledger/src/ledger.invariant.test.ts`

**Interfaces:**
- Consumes: everything exported from `packages/ledger/src/index.ts`.
- Produces: `journalDraftArb: fc.Arbitrary<JournalDraft>` and `postAll(drafts): { books; journals }`

- [ ] **Step 1: Write the generators**

`packages/ledger/src/testing/arbitraries.ts`:
```ts
import { Money, type CurrencyCode } from '@zambooks/shared';
import fc from 'fast-check';
import type { DraftLine, JournalDraft, PostedJournal, Side, CompanyBooks } from '../model';
import { post } from '../post';
import { ACC, ALICE, CO, PARTY, demoBooks, testContext } from './fixtures';

const POSTABLE = [ACC.cash, ACC.ar, ACC.inventory, ACC.ap, ACC.capital, ACC.sales, ACC.expenses] as const;

const rawLine = fc.record({
  acct: fc.integer({ min: 0, max: POSTABLE.length - 1 }),
  side: fc.constantFrom<Side>('DR', 'CR'),
  minor: fc.bigInt({ min: 1n, max: 1_000_000_000_00n }),
  customer: fc.boolean(),
});

/** Positive decimal string with up to 4 dp, built from integers so no float ever touches a rate. */
export const rateArb = fc.integer({ min: 1, max: 99_999_999 }).map((n) => `${Math.floor(n / 10_000)}.${String(n % 10_000).padStart(4, '0')}`);

export const journalDraftArb: fc.Arbitrary<JournalDraft> = fc
  .record({
    raw: fc.array(rawLine, { minLength: 1, maxLength: 8 }),
    currency: fc.constantFrom<CurrencyCode>('ZMW', 'USD'),
    rate: rateArb,
    day: fc.integer({ min: 1, max: 31 }),
    series: fc.constantFrom('GJ', 'SI', 'PI'),
  })
  .map(({ raw, currency, rate, day, series }) => {
    const lines: DraftLine[] = raw.map((r) => {
      const accountId = POSTABLE[r.acct]!;
      const partyId = accountId === ACC.ar || accountId === ACC.ap ? (r.customer ? PARTY.customer : PARTY.supplier) : undefined;
      return { accountId, side: r.side, amount: Money.ofMinor(r.minor, currency), ...(partyId ? { partyId } : {}) };
    });
    const net = raw.reduce((acc, r) => (r.side === 'DR' ? acc + r.minor : acc - r.minor), 0n);
    // A single line always has net != 0, so the offset line guarantees >= 2 lines and balance.
    if (net !== 0n) {
      lines.push({ accountId: ACC.cash, side: net > 0n ? 'CR' : 'DR', amount: Money.ofMinor(net > 0n ? net : -net, currency) });
    }
    return {
      companyId: CO,
      series,
      date: `2026-10-${String(day).padStart(2, '0')}`,
      currency,
      ...(currency === 'USD' ? { fxRate: { from: 'USD', to: 'ZMW', rate, source: 'TEST', rateDate: '2026-10-01' } as const } : {}),
      memo: 'generated',
      authorId: ALICE,
      lines,
    };
  });

export function postAll(drafts: readonly JournalDraft[]): { books: CompanyBooks; journals: PostedJournal[] } {
  const ctx = testContext();
  let books = demoBooks();
  const journals: PostedJournal[] = [];
  for (const d of drafts) {
    const r = post(books, d, ctx);
    books = r.books;
    journals.push(r.journal);
  }
  return { books, journals };
}
```

- [ ] **Step 2: Write the invariant properties**

`packages/ledger/src/ledger.invariant.test.ts`:
```ts
import { Money, errorCode, sumMoney } from '@zambooks/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompanyBooks, PostedJournal } from './model';
import { post } from './post';
import { balanceSheetCheck, subledgerBalances, trialBalance } from './reports';
import { reverse } from './reverse';
import { journalDraftArb, postAll } from './testing/arbitraries';
import { ACC, ALICE, BOB, CO, OTHER_CO, testContext } from './testing/fixtures';

const RUNS = { numRuns: 2000 };
const journalsArb = fc.array(journalDraftArb, { minLength: 1, maxLength: 25 });

function balancedIn(j: PostedJournal): boolean {
  const t = (side: 'DR' | 'CR', key: 'txnAmount' | 'functionalAmount', c: PostedJournal['currency']) =>
    sumMoney(j.lines.filter((l) => l.side === side).map((l) => l[key]), c);
  return t('DR', 'txnAmount', j.currency).equals(t('CR', 'txnAmount', j.currency)) &&
    t('DR', 'functionalAmount', 'ZMW').equals(t('CR', 'functionalAmount', 'ZMW'));
}

function assertBooksInvariants(books: CompanyBooks): void {
  const tb = trialBalance(books, '2026-12-31');
  expect(tb.totalDebit.equals(tb.totalCredit)).toBe(true); // §6.2
  expect(balanceSheetCheck(books, '2026-12-31').holds).toBe(true); // §6.3
  expect(subledgerBalances(books, '2026-12-31', 'AR').reconciles).toBe(true); // §6.4
  expect(subledgerBalances(books, '2026-12-31', 'AP').reconciles).toBe(true); // §6.4
  for (const [series, last] of books.seriesCounters) { // §6.7 gapless
    const numbers = books.journals.filter((j) => j.series === series).map((j) => j.number);
    expect(numbers).toEqual(Array.from({ length: last }, (_, i) => i + 1));
  }
}

describe('§6 ledger invariants (property-based)', () => {
  it('posted journals balance, are fully stamped, and books stay consistent (§6.1, 2, 3, 4, 7, 8, 9, 10)', () => {
    fc.assert(fc.property(journalsArb, (drafts) => {
      const { books, journals } = postAll(drafts);
      for (const j of journals) {
        expect(balancedIn(j)).toBe(true);
        const roundingLines = j.lines.filter((l) => l.isRounding);
        expect(roundingLines.length).toBeLessThanOrEqual(1);
        for (const l of j.lines) {
          expect(l.companyId).toBe(CO);
          expect(l.authorId).toBeTruthy();
          expect(l.postedAt).toBeTruthy();
          expect(books.accounts.has(l.accountId)).toBe(true);
          expect(l.rate && l.rateSource && l.rateDate).toBeTruthy();
          expect(l.functionalAmount.currency).toBe('ZMW');
        }
        for (const r of roundingLines) {
          expect(r.accountId).toBe(ACC.rounding);
          expect(r.txnAmount.isZero()).toBe(true);
          expect(r.functionalAmount.minor * 2n).toBeLessThanOrEqual(BigInt(j.lines.length - 1));
        }
      }
      assertBooksInvariants(books);
    }), RUNS);
  });

  it('reversing any subset keeps every invariant, and reversing all zeroes the TB (§6.5)', () => {
    fc.assert(fc.property(journalsArb, fc.array(fc.boolean(), { maxLength: 25 }), (drafts, picks) => {
      const ctx = testContext();
      let { books } = postAll(drafts);
      const originals = [...books.journals];
      const before = JSON.stringify(originals, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      originals.forEach((j, i) => {
        if (picks[i] ?? true) books = reverse(books, { journalId: j.id, date: '2026-10-31', authorId: ALICE, approverId: BOB }, ctx).books;
      });
      expect(JSON.stringify(books.journals.slice(0, originals.length), (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
      assertBooksInvariants(books);
      if (originals.every((_, i) => picks[i] ?? true)) expect(trialBalance(books, '2026-12-31').rows).toEqual([]);
    }), RUNS);
  });

  it('closed periods reject every posting and leave books unchanged (§6.6)', () => {
    fc.assert(fc.property(journalDraftArb, fc.integer({ min: 1, max: 30 }), (d, day) => {
      const { books } = postAll([]);
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      expect(errorCode(() => post(books, { ...d, date, fxRate: d.fxRate && { ...d.fxRate, rateDate: date } }, testContext()))).toBe('PERIOD_CLOSED');
      expect(books.journals).toHaveLength(0);
    }), RUNS);
  });

  it('cross-tenant postings are impossible (§6.12, domain level)', () => {
    fc.assert(fc.property(journalDraftArb, (d) => {
      const { books } = postAll([]);
      expect(errorCode(() => post(books, { ...d, companyId: OTHER_CO }, testContext()))).toBe('CROSS_TENANT');
    }), RUNS);
  });

  it('any one-minor-unit imbalance is rejected (§6.1)', () => {
    fc.assert(fc.property(journalDraftArb, fc.nat(), (d, k) => {
      const i = k % d.lines.length;
      const lines = d.lines.map((l, idx) => (idx === i ? { ...l, amount: l.amount.add(Money.ofMinor(1n, l.amount.currency)) } : l));
      expect(errorCode(() => post(postAll([]).books, { ...d, lines }, testContext()))).toBe('UNBALANCED');
    }), RUNS);
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `pnpm test:invariants`
Expected: PASS, with 5 properties × 2,000 runs. On failure, fast-check prints a shrunk counterexample. Paste it verbatim into the report, open a bug against the owning task, and do not edit the property.

- [ ] **Step 4: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:invariants && pnpm coverage && pnpm check:register && node --test scripts/*.test.mjs && .claude/hooks/test-hooks.sh`
Expected: all PASS, with ledger coverage at 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src && git commit -m "test(ledger): property-based §6 invariant suite (2000 runs per property)"
```

---

### Task 14: Whole-branch review and hand-off

**Agent:** orchestrator. The reviewer is fable, or opus if most authors were fable.

- [ ] **Step 1:** Dispatch `ledger-reviewer` and `security-reviewer` on `git diff <first-commit>..main`. They return findings with severity.
- [ ] **Step 2:** Fix critical and high findings through the owning task's author, for at most 3 rounds. Log medium findings in `CHANGELOG.md` under "Known issues".
- [ ] **Step 3:** Re-run the Task 13 Step 4 gate, and paste its real output in the hand-off message.
- [ ] **Step 4:** Update `CHANGELOG.md`. Confirm that register entries ZM-0001 to ZM-0003 are still `VERIFY`. Commit with `chore: plan 01 complete`.
- [ ] **Step 5:** Write plan 02 (persistence + RLS) and plan 03 (identity + audit) against the now-fixed interfaces.
