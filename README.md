Exploring Cloudflare + Sentry + ORPC + Effect.

```bash
# install deps
yarn

# copy .env.example and set your sentry dsn in there if you want to actually send events to sentry
cp .env.example .env

# run it
yarn dev

# make some requests and check the logs in the terminal to see the transactions that would be sent to sentry

# Debug endpoint - shows Sentry release and version metadata
curl -i http://localhost:8787/api/debug

# 1. basic orpc -> effect
curl -i http://localhost:8787/api/effect

# 2. Same as 1, but demonstrates error handling and reporting
curl -i http://localhost:8787/api/effect-error

# 3. Same as 1, but orpc -> durable object -> effect
curl -i http://localhost:8787/api/durable-object

# 4. Same as 2, but orpc -> durable object -> effect
curl -i http://localhost:8787/api/durable-object-error

# 5. Runs an effect program that outlives the original request
curl -i http://localhost:8787/api/forked-effect

# 6. Same as 5, but orpc -> durable object -> effect program w background fiber
curl -i http://localhost:8787/api/durable-object-forked-effect
```

Tried many things to get the effect open telemetry tracer working with all of these examples, but no luck.

Turns out making a custom tracer for Sentry was easy. It's over here -> worker/effect-sentry-tracer.ts.

I needed to patch the sentry/cloudflare package to expose `init`, so that we can use it in our continueTrace helper.
