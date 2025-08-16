import { NodeSdk } from '@effect/opentelemetry';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Effect } from 'effect';

const child = Effect.void.pipe(Effect.delay('100 millis'), Effect.withSpan('child'));

const parent = Effect.gen(function* () {
  yield* Effect.log('parent called');
  yield* Effect.sleep('20 millis');
  yield* child;
  yield* Effect.sleep('10 millis');
}).pipe(Effect.withSpan('parent'));

const NodeSdkLive = NodeSdk.layer(() => ({
  resource: { serviceName: 'example' },
  spanProcessor: new (class extends SimpleSpanProcessor {
    override onEnd(span: any): void {
      console.log('SPAN ENDING', {
        name: span.name,
        spanId: span.spanContext().spanId,
        traceId: span.spanContext().traceId,
        parentSpanId: span.parentSpanId,
      });
      super.onEnd(span);
    }
  })(new ConsoleSpanExporter()),
}));

export default {
  fetch: async () => {
    await Effect.runPromise(parent.pipe(Effect.provide(NodeSdkLive)));

    return new Response(`Hello, world! ${Date.now()}`);
  },
} satisfies ExportedHandler<Env>;
