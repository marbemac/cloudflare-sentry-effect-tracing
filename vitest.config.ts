import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        /**
         * TMP workaround for this issue, must build before running tests:
         * - https://github.com/cloudflare/workers-sdk/issues/9719
         * - https://github.com/cloudflare/workers-sdk/issues/7324#issuecomment-2508269553
         */
        main: 'dist/index.js',
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
