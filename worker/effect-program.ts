import { Effect, Layer, ManagedRuntime, Scope } from 'effect';
import { SentryLoggerLayer } from './effect-sentry-logger';
import { SentryTracerLive, withTransactionSpanScoped } from './effect-sentry-tracer';

const childEffect = Effect.gen(function* () {
  yield* Effect.sleep('10 millis');
}).pipe(
  Effect.delay('100 millis'),
  Effect.withSpan('childEffect', {
    attributes: {
      'span.level': 2,
    },
  }),
);

const parentEffect = Effect.gen(function* () {
  yield* Effect.withSpan('probe-span')(Effect.logInfo('Inside probe span'));

  yield* Effect.sleep('20 millis');
  yield* childEffect;
  yield* Effect.sleep('10 millis');
}).pipe(
  Effect.withSpan('parentEffect', {
    attributes: {
      'span.level': 1,
    },
  }),
);

// Error-throwing effects for testing error propagation
const childWithError = Effect.gen(function* () {
  yield* Effect.logWarning('Child span executing before error', { 'test.logprop': true });
  yield* Effect.sleep('50 millis');

  // Throw a structured error for testing
  yield* Effect.fail({
    name: 'ChildEffectError',
    message: 'Intentional error from child Effect for testing error propagation',
  });
}).pipe(
  Effect.withSpan('child-with-error', {
    attributes: {
      'span.type': 'child',
      'span.level': 2,
      'test.error': true,
    },
  }),
);

const parentWithError = Effect.gen(function* () {
  yield* Effect.sleep('20 millis');

  // This will fail when childWithError throws
  yield* childWithError;

  yield* Effect.sleep('10 millis');
}).pipe(
  Effect.withSpan('parent-with-error', {
    attributes: {
      'span.type': 'parent',
      'span.level': 1,
      'test.error': true,
    },
  }),
);

const effectWithBackgroundFork = Effect.fnUntraced(function* () {
  const cs = yield* Effect.currentSpan;
  console.log('🔥 Outside background fiber', cs.spanId);

  const backgroundFiber = yield* Effect.gen(function* () {
    const cs = yield* Effect.currentSpan;
    console.log('🔥 Inside background fiber', cs.spanId);

    yield* Effect.sleep('1 second');

    yield* parentEffect;

    console.log('🔥 Background fiber finished');
  }).pipe(Effect.forkScoped);

  return { backgroundFiber };
}, withTransactionSpanScoped('effectWithBackgroundFork'));

const forkedEffect = Effect.gen(function* () {
  const scope = yield* Scope.make();

  const res = yield* effectWithBackgroundFork().pipe(Scope.extend(scope));

  return { ...res, scope };
}).pipe(Effect.withSpan('forkedEffect'));

// Layer that combines tracing and Sentry logging
const AppLayer = Layer.provideMerge(SentryTracerLive, SentryLoggerLayer);

export const runtime = ManagedRuntime.make(AppLayer);

/**
 * Runs an example effect program that is meant to demonstrate
 * parent-child calls within Effect, so we can observe how our trace implementation is working.
 */
export const runEffectProgram = () => {
  return runtime.runPromise(parentEffect);
};

/**
 * Runs an Effect program that intentionally throws an error to test error propagation
 * through the distributed trace and ensure errors are captured by Sentry.
 */
export const runEffectWithError = () => {
  return runtime.runPromise(parentWithError);
};

export const runForkedEffect = () => {
  return runtime.runPromise(forkedEffect);
};
