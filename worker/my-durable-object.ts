import { DurableObject } from 'cloudflare:workers';
import { runEffectProgram, runEffectWithError, runForkedEffect, runtime } from './effect-program';
import { continueTraceableRPC, type WithTrace } from './rpc-tracing-helpers';
import { Effect, Exit, Fiber, Scope } from 'effect';
import { flush } from '@sentry/cloudflare';
import { instrumentDurableObjectWithSentry } from '@sentry/cloudflare';
import { makeSentryOptions } from './make-sentry-options.ts';

type ExampleProps = {};

// Not using instrumentDurableObjectWithSentry because it doesn't support traceable RPC methods
// and it seems to cause the trace propagation on rpc methods that we're doing to not work as expected for some reason
class MyDurableObjectBase extends DurableObject<Env> {
  async runEffect(props: WithTrace<ExampleProps>) {
    return continueTraceableRPC('durable-object-runEffect', this.#runEffect, this.ctx.waitUntil.bind(this.ctx), props);
  }

  #runEffect = async (_: ExampleProps) => {
    await runEffectProgram();
    return { hello: 'from durable object' };
  };

  async runEffectWithError(props: WithTrace<ExampleProps>) {
    return continueTraceableRPC(
      'durable-object-runEffectWithError',
      this.#runEffectWithError,
      this.ctx.waitUntil.bind(this.ctx),
      props,
    );
  }

  #runEffectWithError = async (_: ExampleProps) => {
    await runEffectWithError();
    return { hello: 'from durable object (this should not be reached due to error)' };
  };

  async runForkedEffect(props: WithTrace<ExampleProps>) {
    return continueTraceableRPC(
      'durable-object-runForkedEffect',
      this.#runForkedEffect,
      this.ctx.waitUntil.bind(this.ctx),
      props,
    );
  }

  #runForkedEffect = async (_: ExampleProps) => {
    const res = await runForkedEffect();

    this.ctx.waitUntil(
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
  };
}

export const MyDurableObject = instrumentDurableObjectWithSentry(makeSentryOptions, MyDurableObjectBase);
