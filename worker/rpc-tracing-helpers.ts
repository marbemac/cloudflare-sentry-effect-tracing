import { continueTrace, flush, getTraceData, startSpan } from '@sentry/cloudflare';

/**
 * Trace context structure for RPC propagation
 */
interface TraceContext {
  sentryTrace: string;
  baggage?: string;
}

/**
 * Special property name for trace context in RPC arguments
 */
const SENTRY_TRACE_PROPERTY = '__sentryTrace' as const;
type SentryTraceKey = typeof SENTRY_TRACE_PROPERTY;

export type WithTrace<T extends Record<string, unknown>> = T & { [K in SentryTraceKey]?: TraceContext };

/**
 * Client-side helper to make RPC calls with distributed trace propagation.
 * This function extracts the current trace context and embeds it in the RPC arguments
 * so that the receiving service can continue the distributed trace.
 *
 * @param fn - The RPC function to call (e.g., durableObjectStub.methodName)
 * @param args - Arguments to pass to the RPC method
 * @returns Promise resolving to the RPC method result
 *
 * @example
 * ```typescript
 * const stub = env.MY_DURABLE_OBJECT.getByName('static-name');
 * const result = await callTraceableRPC(stub.runEffect, { someParam: 'value' });
 * ```
 */
export function callTraceableRPC<A extends Record<string, unknown>, R>(
  fn: (arg: WithTrace<A>) => Promise<R> | R,
  args: A,
): Promise<R> {
  const traceData = getTraceData();

  const argsWithTrace = {
    ...args,
    [SENTRY_TRACE_PROPERTY]: {
      sentryTrace: traceData['sentry-trace'],
      baggage: traceData.baggage,
    } as TraceContext,
  } as WithTrace<A>;

  return fn(argsWithTrace) as Promise<R>;
}

/**
 * Server-side helper to continue trace propagation in RPC methods.
 * This function extracts trace context from RPC arguments, continues the distributed trace,
 * and wraps the method execution in a properly traced span.
 *
 * @param spanName - Name for the span created for this RPC method
 * @param fn - The actual RPC method implementation to execute
 * @param waitUntil - Cloudflare's waitUntil function for background tasks (e.g., flushing traces)
 * @param args - RPC arguments with embedded trace context
 * @returns Promise resolving to the RPC method result
 *
 * @example
 * ```typescript
 * async runEffect(props: WithTrace<ExampleProps>) {
 *   return continueTraceableRPC('runEffect', this.#runEffect, this.ctx.waitUntil.bind(this.ctx), props);
 * }
 * ```
 */
export function continueTraceableRPC<F extends (args: any) => any>(
  spanName: string,
  fn: F,
  waitUntil: DurableObjectState['waitUntil'],
  args: WithTrace<Parameters<F>[0]>,
): Promise<Awaited<ReturnType<F>>> {
  const { [SENTRY_TRACE_PROPERTY]: traceContext, ...cleanArgs } = args as any;

  if (!traceContext?.sentryTrace) {
    console.warn(`⚠️ continueTraceableRPC: No trace context for ${spanName}, calling fn directly`, traceContext);
  }

  return continueTrace({ sentryTrace: traceContext.sentryTrace || '', baggage: traceContext.baggage }, () =>
    startSpan(
      {
        name: spanName,
        op: 'rpc',
        attributes: {
          'sentry.origin': 'auto.rpc.durable_object',
        },
      },
      async () => {
        try {
          const res = await fn(cleanArgs as Parameters<F>[0]);
          return res;
        } finally {
          waitUntil(flush(2000));
        }
      },
    ),
  ) as Promise<Awaited<ReturnType<F>>>;
}
