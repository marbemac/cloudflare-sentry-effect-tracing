import { cloudflare } from '@cloudflare/vite-plugin';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import tsConfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    sourcemap: true, // Source map generation must be turned on
  },
  plugins: [
    sentryVitePlugin({
      authToken: process.env['SENTRY_AUTH_TOKEN'],
      // https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-thirdpartyerrorfilterintegration
      applicationKey: 'cloudflare-sentry-effect-tracing',
      telemetry: false,
      org: process.env['SENTRY_ORG'],
      project: process.env['SENTRY_PROJECT'],
    }),
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      routeToken: 'layout',
    }),
    react(),
    cloudflare(),
    tsConfigPaths(),
    process.argv.includes('--analyze') ? analyzer() : null,
  ],
});
