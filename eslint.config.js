import { reactConfig } from '@datanaut/eslint-config/react';

export default [
  ...reactConfig,
  {
    files: ['worker/**/*.ts'],
    rules: {
      // cloudflare:workers imports are working fine with typescript, but eslint is not happy
      // https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
      'no-undef': 'off',
      'import/no-unresolved': ['error', { ignore: ['^cloudflare:workers'] }],
    },
  },
];
