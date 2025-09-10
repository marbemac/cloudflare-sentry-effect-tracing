import * as Sentry from '@sentry/react';
import * as ReactDOM from 'react-dom/client';
import { createRouter as baseCreateRouter } from '@tanstack/react-router';

import { Providers } from './Providers.tsx';
import { routeTree } from './routeTree.gen.ts';

export function createRouter() {
  return baseCreateRouter({
    routeTree,
    defaultPreload: 'intent',
    context: {},
    defaultStructuralSharing: true,
    defaultPreloadDelay: 100,
  });
}

const router = createRouter();

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  tracesSampleRate: 1.0,
  sendDefaultPii: true,
  // ignore asset loading spans in development
  ignoreSpans: import.meta.env.DEV ? [{ op: 'resource.script' }] : [],
  environment: import.meta.env.DEV ? 'development' : 'production',
  integrations: [
    Sentry.tanstackRouterBrowserTracingIntegration(router),
    Sentry.thirdPartyErrorFilterIntegration({
      // Specify the application keys that you specified in the Sentry bundler plugin (vite.config.ts)
      filterKeys: ['cloudflare-sentry-effect-tracing'],
      behaviour: 'drop-error-if-contains-third-party-frames',
    }),
  ],
});

// Register things for typesafety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('app')!;

const root = ReactDOM.createRoot(container, {
  // Callback called when an error is thrown and not caught by an ErrorBoundary.
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn('Uncaught error', error, errorInfo.componentStack);
  }),
  // Callback called when React catches an error in an ErrorBoundary.
  onCaughtError: Sentry.reactErrorHandler(),
  // Callback called when React automatically recovers from errors.
  onRecoverableError: Sentry.reactErrorHandler(),
});

root.render(<Providers router={router} />);
