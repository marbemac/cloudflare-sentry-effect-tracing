import {
  captureException,
  getActiveSpan,
  type Span as SentrySpan,
  type SpanAttributes,
  type SpanAttributeValue,
  startInactiveSpan,
  withActiveSpan,
} from '@sentry/core';
import { Cause, Context, Effect, type Exit, Layer, Option, type Scope, Tracer as EffectTracer } from 'effect';

const SentrySpanTypeId = Symbol.for('@effect/sentry-tracer/Span');

// Context tag to force Sentry to treat the next span as a transaction
export interface ForceTransaction {
  readonly _: unique symbol;
}
export const ForceTransaction = Context.GenericTag<ForceTransaction, boolean>('@effect/sentry-tracer/ForceTransaction');

function nanosToHrTime(nanos: bigint): [number, number] {
  const sec = Number(nanos / 1_000_000_000n);
  const ns = Number(nanos % 1_000_000_000n);
  return [sec, ns];
}

function prepareLinkAttributes(attributes?: Readonly<Record<string, unknown>>): SpanAttributes | undefined {
  if (!attributes) return undefined;
  const result: SpanAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) {
      result[key] = undefined;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => (v == null ? (v as null) : String(v)));
    } else {
      result[key] = String(value);
    }
  }
  return result;
}

// Custom Sentry-based span implementation that matches Effect's Span interface
export class SentryEffectSpan implements EffectTracer.Span {
  readonly [SentrySpanTypeId]: typeof SentrySpanTypeId;
  readonly _tag = 'Span' as const;

  readonly spanId: string;
  readonly traceId: string;
  readonly attributes = new Map<string, unknown>();
  readonly sampled: boolean;
  status: EffectTracer.SpanStatus;

  constructor(
    readonly sentrySpan: SentrySpan,
    readonly name: string,
    readonly parent: Option.Option<EffectTracer.AnySpan>,
    readonly context: Context.Context<never>,
    readonly links: Array<EffectTracer.SpanLink>,
    startTime: bigint,
    readonly kind: EffectTracer.SpanKind,
  ) {
    this[SentrySpanTypeId] = SentrySpanTypeId;

    const spanContext = sentrySpan.spanContext();
    this.spanId = spanContext.spanId;
    this.traceId = spanContext.traceId;
    this.sampled = spanContext.traceFlags === 1; // SAMPLED flag

    this.status = {
      _tag: 'Started',
      startTime,
    };
  }

  attribute(key: string, value: unknown): void {
    const attributeValue = this.toSentryAttributeValue(value);
    this.sentrySpan.setAttribute(key, attributeValue);
    this.attributes.set(key, value);
  }

  private toSentryAttributeValue(value: unknown): SpanAttributeValue | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      // Convert arrays to string arrays for type safety
      return value.map(v => (v == null ? (v as null) : String(v)));
    }
    return String(value);
  }

  addLinks(links: ReadonlyArray<EffectTracer.SpanLink>): void {
    this.links.push(...links);
    this.sentrySpan.addLinks(
      links.map(link => ({
        context: {
          traceId: link.span.traceId,
          spanId: link.span.spanId,
          traceFlags: link.span.sampled ? 1 : 0,
        },
        attributes: prepareLinkAttributes(link.attributes),
      })),
    );
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    this.status = {
      _tag: 'Ended',
      endTime,
      exit,
      startTime: this.status.startTime,
    };

    // Map Effect exit to Sentry span status
    if (exit._tag === 'Success') {
      this.sentrySpan.setStatus({ code: 1 }); // OK
    } else {
      if (Cause.isInterruptedOnly(exit.cause)) {
        this.sentrySpan.setStatus({
          code: 2,
          message: Cause.pretty(exit.cause),
        });

        this.sentrySpan.setAttribute('effect.interrupted', true);
      } else {
        const firstError = Cause.prettyErrors(exit.cause)[0];
        if (firstError) {
          firstError.stack = Cause.pretty(exit.cause, { renderErrorCause: true });
          // this.sentrySpan.recordException(firstError);
          captureException(firstError, {
            contexts: {
              trace: {
                trace_id: this.traceId,
                span_id: this.spanId,
              },
            },
          });
          this.sentrySpan.setStatus({
            code: 2,
            message: firstError.message,
          });
        } else {
          // empty cause means no error
          this.sentrySpan.setStatus({ code: 1 });
        }
      }
    }

    this.sentrySpan.end(nanosToHrTime(endTime));
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    // Sentry v8: Convert attributes to proper format for events
    const sentryAttributes = attributes ? prepareLinkAttributes(attributes) : undefined;
    this.sentrySpan.addEvent(name, sentryAttributes, nanosToHrTime(startTime));
  }
}

// Create the custom Sentry tracer
export const makeSentryTracer = (): EffectTracer.Tracer => {
  return EffectTracer.make({
    span(name, parent, context, links, startTime, kind) {
      // Find parent Sentry span
      let parentSentrySpan: SentrySpan | undefined;

      if (parent._tag === 'Some') {
        if (parent.value._tag === 'Span' && SentrySpanTypeId in parent.value) {
          // Parent is our custom Sentry span
          parentSentrySpan = (parent.value as SentryEffectSpan).sentrySpan;
        } else {
          // Parent is external span - get current active Sentry span
          parentSentrySpan = getActiveSpan();
        }
      } else {
        // No parent - get current active Sentry span
        parentSentrySpan = getActiveSpan();
      }

      // Map Effect span kind to Sentry op
      const op =
        kind === 'server'
          ? 'http.server'
          : kind === 'client'
            ? 'http.client'
            : kind === 'producer'
              ? 'messaging.producer'
              : kind === 'consumer'
                ? 'messaging.consumer'
                : undefined;

      // Check if this span should be forced to be a transaction (via Effect context)
      const forceTransaction = Option.getOrElse(Context.getOption(context, ForceTransaction), () => false);

      // Create Sentry span with precise timing and links
      const sentrySpan = startInactiveSpan({
        name,
        parentSpan: parentSentrySpan,
        startTime: nanosToHrTime(startTime),
        op,
        forceTransaction,
        links: links.map(link => ({
          context: {
            traceId: link.span.traceId,
            spanId: link.span.spanId,
            traceFlags: link.span.sampled ? 1 : 0,
          },
          attributes: prepareLinkAttributes(link.attributes),
        })),
      });

      return new SentryEffectSpan(sentrySpan, name, parent, context, links.slice(), startTime, kind);
    },

    context(execution, fiber) {
      const currentSpan = fiber.currentSpan;

      if (currentSpan === undefined) {
        return execution();
      }

      // If it's our custom Sentry span, use Sentry's context propagation
      if (SentrySpanTypeId in currentSpan) {
        const sentrySpan = (currentSpan as SentryEffectSpan).sentrySpan;
        return withActiveSpan(sentrySpan, _scope => execution());
      }

      // Otherwise just execute normally
      return execution();
    },
  });
};

// Layer to provide the custom Sentry tracer
export const SentryTracerLive = Layer.setTracer(makeSentryTracer());

/**
 * Wrap an Effect in a scoped span that will be forced to be a Sentry transaction.
 *
 * Use this when the target effect is expected to live beyond the current scope.
 *
 * For example, if you fork an effect and keep it running in the background after you return a request and finish the parent transaction.
 */
export const withTransactionSpanScoped =
  (name: string, options?: EffectTracer.SpanOptions & { op?: string }) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, EffectTracer.ParentSpan> | Scope.Scope> => {
    const spanOpts: EffectTracer.SpanOptions = {
      ...options,
      context: Context.add(options?.context ?? Context.empty(), ForceTransaction, true),
    };

    return Effect.withSpanScoped(name, spanOpts)(self);
  };
