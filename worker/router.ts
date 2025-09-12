import { env } from 'cloudflare:workers';
import { os } from '@orpc/server';
import { captureException, flush } from '@sentry/core';
import * as Runtime from 'effect/Runtime';
import * as Cause from 'effect/Cause';

import { runEffectProgram, runEffectWithError, runForkedEffect, runtime } from './effect-program.ts';
import { Effect, Exit, Fiber, Scope } from 'effect';
import { callTraceableRPC } from './my-durable-object.ts';

function sleepRandom(): Promise<void> {
  const ms = Math.floor(Math.random() * (100 - 10 + 1)) + 10;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unwrapFiberFailure(error: unknown): Error {
  if (Runtime.isFiberFailure(error)) {
    const FiberFailureCauseId = Symbol.for('effect/Runtime/FiberFailure/Cause');
    const cause = (error as any)[FiberFailureCauseId];

    if (cause) {
      try {
        const prettyErrors = Cause.prettyErrors(cause);
        const originalError = prettyErrors[0];

        if (originalError) {
          const unwrapped = new Error(originalError.message);
          unwrapped.name = originalError.name;
          unwrapped.stack = originalError.stack;
          return unwrapped;
        }
      } catch {
        // Fall back to original error if unwrapping fails
      }
    }
  }

  if (error instanceof Error) {
    // Errors serialized over the wire (from durable object rpc call, for example) will not
    // be identified as fiberFailures but might still have (FiberFailure) in the name
    // just a simple tweak to remove it
    if (error.name.includes('(FiberFailure)')) {
      // (FiberFailure) Error
      error.name = error.name.replace('(FiberFailure)', '').trim();
    } else if (error.message.startsWith('(FiberFailure)')) {
      // Extract name and message from the prefixed error message
      // Format: "(FiberFailure) {name}: {actual message}"
      const messageWithoutPrefix = error.message.replace('(FiberFailure)', '').trim();
      const colonIndex = messageWithoutPrefix.indexOf(':');

      if (colonIndex !== -1) {
        error.name = messageWithoutPrefix.substring(0, colonIndex).trim();
        error.message = messageWithoutPrefix.substring(colonIndex + 1).trim();
      } else {
        // If no colon found, treat the whole thing as the message
        error.message = messageWithoutPrefix;
      }
    }

    return error;
  }

  return new Error(String(error));
}

const sentryMiddleware = os.middleware(async function sentryMiddleware({ next }) {
  try {
    return await next();
  } catch (error) {
    console.error(error);

    // Errors reported by the SentrySpanProcessor will be unwrapped, so we unwrap here
    // as well to align them and prevent sentry from thinking they are two separate issues
    // E.g. without this the error reported here would have name "Error (FiberFailure)" while
    // the one reported in the sentry span processor would have name "Error"
    const unwrappedError = unwrapFiberFailure(error);
    console.warn('Error captured with name: ', unwrappedError.name);
    captureException(unwrappedError);
    throw error;
  }
});

// Configures the name used for the tracing span associated with this middleware
Object.defineProperty(sentryMiddleware, 'name', { value: 'sentryMiddleware', configurable: true });

export interface RootContext {
  waitUntil: DurableObjectState['waitUntil'];
}

const base = os.$context<RootContext>().use(sentryMiddleware);

export const effectExample = base
  .route({
    method: 'GET',
    path: '/api/effect',
  })
  .handler(async () => {
    await sleepRandom();
    await runEffectProgram();
    await sleepRandom();

    return [{ ok: true }];
  });

export const effectExampleWithError = base
  .route({
    method: 'GET',
    path: '/api/effect-error',
  })
  .handler(async () => {
    await sleepRandom();
    await runEffectWithError();
    await sleepRandom();

    return [{ ok: true }];
  });

export const durableObjectExample = base
  .route({
    method: 'GET',
    path: '/api/durable-object',
  })
  .handler(async () => {
    await sleepRandom();

    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    const res = await callTraceableRPC(stub, 'runEffect');

    await sleepRandom();

    return res;
  });

export const durableObjectErrorExample = base
  .route({
    method: 'GET',
    path: '/api/durable-object-error',
  })
  .handler(async () => {
    await sleepRandom();

    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    const res = await callTraceableRPC(stub, 'runEffectWithError');

    await sleepRandom();

    return res;
  });

export const forkedEffectExample = base
  .route({
    method: 'GET',
    path: '/api/forked-effect',
  })
  .handler(async ({ context }) => {
    await sleepRandom();

    const res = await runForkedEffect();

    await sleepRandom();

    context.waitUntil(
      runtime.runPromise(
        res.backgroundFiber.pipe(
          Fiber.join,
          Effect.andThen(() =>
            Effect.gen(function* () {
              yield* Scope.close(res.scope, Exit.succeed('done'));
              yield* Effect.promise(() => flush(2000));
            }),
          ),
        ),
      ),
    );

    return { ok: true };
  });

export const durableObjectForkedEffectExample = base
  .route({
    method: 'GET',
    path: '/api/durable-object-forked-effect',
  })
  .handler(async () => {
    await sleepRandom();

    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    await sleepRandom();

    return callTraceableRPC(stub, 'runForkedEffect', { justToShowThatTypesWork: true });
  });

export const router = {
  effect: effectExample,
  effectWithError: effectExampleWithError,
  durableObject: durableObjectExample,
  durableObjectError: durableObjectErrorExample,
  forkedEffect: forkedEffectExample,
  durableObjectForkedEffect: durableObjectForkedEffectExample,
};
