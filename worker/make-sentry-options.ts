import type { CloudflareOptions } from '@sentry/cloudflare';
import { consoleLoggingIntegration } from '@sentry/core';

export const makeSentryOptions = (env: Env, options: CloudflareOptions = {}) =>
  ({
    dsn: env.VITE_SENTRY_DSN,
    tracesSampleRate: 1,
    release: env.SENTRY_RELEASE,
    sendDefaultPii: true,

    environment: import.meta.env.MODE,

    debug: true,

    // Send structured logs to Sentry
    enableLogs: true,

    ignoreTransactions: ['/favicon.ico'],

    integrations: [consoleLoggingIntegration({ levels: ['warn', 'error'] })],

    // beforeSendLog: log => {
    //   console.log('📋 beforeSendLog', log);
    //   return log;
    // },

    // Using beforeTransaction to log out whatever details we need in
    // order to debug the transaction being sent to Sentry
    // feel free to update this to adjust what is logged out to help you debug as we go
    beforeSendTransaction: transaction => {
      const transactionData = {
        event_id: transaction.event_id,
        transaction: transaction.transaction,
        spans: transaction.spans?.map(s => ({
          op: s.op,
          description: s.description,
          span_id: s.span_id,
          parent_span_id: s.parent_span_id,
          trace_id: s.trace_id,
          start_timestamp: s.start_timestamp,
          timestamp: s.timestamp,
        })),
        contexts: {
          trace: transaction.contexts?.trace,
        },
      };

      console.log('\n--------------------------------');
      console.log('🚀 Sentry transaction being sent:');
      console.log(`  Trace ID: ${transactionData.contexts?.trace?.trace_id}`);
      console.log(`  Transaction: ${transactionData.transaction}`);
      console.log(`  Parent Span ID: ${transaction.contexts?.trace?.parent_span_id}`);
      console.log(`  Span ID: ${transaction.contexts?.trace?.span_id}`);
      console.log(`  Type: ${transaction.type}`);
      console.log(`  Event ID: ${transactionData.event_id}`);
      console.log(`  Spans: ${transactionData.spans?.length || 0}`);
      transactionData.spans?.forEach((span, i) => {
        console.log(
          `    ${i + 1}. ${span.description} (${span.op}) (id: ${span.span_id}, parent: ${span.parent_span_id})`,
        );
      });
      console.log('--------------------------------\n');

      return transaction;
    },
    ...options,
  }) as const satisfies CloudflareOptions;
