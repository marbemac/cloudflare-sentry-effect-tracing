import { DurableObject } from 'cloudflare:workers';
import { runEffectProgram, runEffectWithError, runForkedEffect, runtime } from './effect-program';
import { makeTraceableRPCHelpers, type WithTrace } from './rpc-tracing-helpers';
import { Effect, Exit, Fiber, Scope } from 'effect';
import { flush } from '@sentry/cloudflare';

type ExampleProps = {};

export const { callTraceableRPC, continueTraceableRPC } = makeTraceableRPCHelpers({ serviceName: 'MyDurableObject' });

// Not using instrumentDurableObjectWithSentry because it doesn't support traceable RPC methods
// and it seems to cause the trace propagation on rpc methods that we're doing to not work as expected for some reason
export class MyDurableObject extends DurableObject<Env> {
  async runEffect(props: WithTrace<ExampleProps>) {
    return continueTraceableRPC('runEffect', this.#runEffect, this.ctx.waitUntil.bind(this.ctx), props);
  }

  #runEffect = async (_: ExampleProps) => {
    await runEffectProgram();
    return { hello: 'from durable object' };
  };

  async runEffectWithError(props: WithTrace<ExampleProps>) {
    return continueTraceableRPC(
      'runEffectWithError',
      this.#runEffectWithError,
      this.ctx.waitUntil.bind(this.ctx),
      props,
    );
  }

  #runEffectWithError = async (_: ExampleProps) => {
    await runEffectWithError();
    return { hello: 'from durable object (this should not be reached due to error)' };
  };

  async runForkedEffect(props: WithTrace<{ justToShowThatTypesWork: boolean }>) {
    return continueTraceableRPC('runForkedEffect', this.#runForkedEffect, this.ctx.waitUntil.bind(this.ctx), props);
  }

  #runForkedEffect = async (_: { justToShowThatTypesWork: boolean }) => {
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

    return { hello: 'from durable object that has a background fiber that continues beyond this request' };
  };
}
