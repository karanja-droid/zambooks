import tseslint from 'typescript-eslint';

const FLOAT_MESSAGE = 'Money is never a float (spec §0.3). Use Money (bigint minor units) and convert() from @zambooks/shared.';
const PURE_MESSAGE = 'packages/ledger is pure (spec §13): time and ids come in through LedgerContext.';

const MONEY_SRC = ['packages/shared/src/**/*.ts', 'packages/ledger/src/**/*.ts', 'packages/tax-zm/src/**/*.ts'];
const MONEY_EXEMPT = ['**/*.test.ts', '**/testing/**', 'packages/shared/src/testing.ts'];

// Shared by both blocks: ESLint replaces (does not merge) a rule's options per matching config block.
const floatSyntax = [
  { selector: "CallExpression[callee.type='Identifier'][callee.name='Number']", message: FLOAT_MESSAGE },
  { selector: "CallExpression[callee.property.name='toFixed']", message: FLOAT_MESSAGE },
];
const floatProperties = [
  { object: 'Number', property: 'parseFloat', message: FLOAT_MESSAGE },
  { object: 'Number', property: 'parseInt', message: FLOAT_MESSAGE },
  ...['round', 'floor', 'ceil', 'trunc'].map((property) => ({ object: 'Math', property, message: FLOAT_MESSAGE })),
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/coverage/**', '**/dist/**'] },
  ...tseslint.configs.strict,
  {
    files: MONEY_SRC,
    ignores: MONEY_EXEMPT,
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: FLOAT_MESSAGE },
        { name: 'parseInt', message: FLOAT_MESSAGE },
      ],
      'no-restricted-syntax': ['error', ...floatSyntax],
      'no-restricted-properties': ['error', ...floatProperties],
    },
  },
  {
    files: ['packages/ledger/src/**/*.ts'],
    ignores: MONEY_EXEMPT,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...floatSyntax,
        { selector: "NewExpression[callee.name='Date']", message: PURE_MESSAGE },
      ],
      'no-restricted-properties': [
        'error',
        ...floatProperties,
        { object: 'Date', property: 'now', message: PURE_MESSAGE },
        { object: 'Math', property: 'random', message: PURE_MESSAGE },
      ],
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*'], message: PURE_MESSAGE }] }],
    },
  },
);
