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
