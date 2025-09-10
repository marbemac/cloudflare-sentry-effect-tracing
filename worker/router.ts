import { env } from 'cloudflare:workers';
import { os } from '@orpc/server';
import { captureException, flush } from '@sentry/core';
import * as Runtime from 'effect/Runtime';
import * as Cause from 'effect/Cause';

import { runEffectProgram, runEffectWithError, runForkedEffect, runtime } from './effect-program.ts';
import { callTraceableRPC } from './rpc-tracing-helpers.ts';
import { Effect, Exit, Fiber, Scope } from 'effect';

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

const sentryMiddleware = os.middleware(async ({ next }) => {
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

export interface RootContext {
  waitUntil: DurableObjectState['waitUntil'];
}

const base = os.$context<RootContext>().use(sentryMiddleware);

export const debug = base
  .route({
    method: 'GET',
    path: '/api/debug',
  })
  .handler(async () => {
    return {
      sentryRelease: env.SENTRY_RELEASE,
      versionMetadata: env.CF_VERSION_METADATA,
    };
  });

export const effectExample = base
  .route({
    method: 'GET',
    path: '/api/effect',
  })
  .handler(async () => {
    await runEffectProgram();

    return [{ ok: true }];
  });

export const effectExampleWithError = base
  .route({
    method: 'GET',
    path: '/api/effect-error',
  })
  .handler(async () => {
    await runEffectWithError();

    return [{ ok: true }];
  });

export const durableObjectExample = base
  .route({
    method: 'GET',
    path: '/api/durable-object',
  })
  .handler(async () => {
    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    try {
      // Use callTraceableRPC to propagate trace context to the Durable Object
      const res = await callTraceableRPC(stub.runEffect, {});
      return res;
    } catch (error) {
      console.error('Error calling runEffect:', error);
      return { error: 'Failed to call runEffect' };
    }
  });

export const durableObjectErrorExample = base
  .route({
    method: 'GET',
    path: '/api/durable-object-error',
  })
  .handler(async () => {
    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    const res = await callTraceableRPC(stub.runEffectWithError, {});

    return res;
  });

export const forkedEffectExample = base
  .route({
    method: 'GET',
    path: '/api/forked-effect',
  })
  .handler(async ({ context }) => {
    const res = await runForkedEffect();

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
    const stub = env.MY_DURABLE_OBJECT.getByName('static-name');

    await callTraceableRPC(stub.runForkedEffect, {});
  });

export const router = {
  debug: debug,
  effect: effectExample,
  effectWithError: effectExampleWithError,
  durableObject: durableObjectExample,
  durableObjectError: durableObjectErrorExample,
  forkedEffect: forkedEffectExample,
  durableObjectForkedEffect: durableObjectForkedEffectExample,
};
