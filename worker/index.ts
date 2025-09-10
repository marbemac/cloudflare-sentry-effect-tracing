import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { ORPCInstrumentation } from '@orpc/otel';
import { withSentry, consoleLoggingIntegration } from '@sentry/cloudflare';

import { router } from './router.ts';
import { makeSentryOptions } from './make-sentry-options.ts';

export { MyDurableObject } from './my-durable-object.ts';

// Enable oRPC OpenTelemetry instrumentation
const orpcInstrumentation = new ORPCInstrumentation();
orpcInstrumentation.enable();

const orpcHandler = new OpenAPIHandler(router);

export default withSentry(makeSentryOptions, {
  async fetch(req, _env, ctx) {
    console.log('\n=== DEMO: Sentry + ORPC + Effect Tracing ===');
    console.log(`Request: ${req.method} ${new URL(req.url).pathname}`);

    const orpcResult = await orpcHandler.handle(req, { context: { waitUntil: ctx.waitUntil.bind(ctx) } });
    if (orpcResult.matched) {
      return orpcResult.response;
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>);
