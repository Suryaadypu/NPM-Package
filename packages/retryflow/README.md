# retryflow-lite

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

RetryFlow is a small, zero-runtime-dependency retry helper for flaky network calls, database operations, and background work. It supports exponential backoff, jitter, per-attempt timeouts, and `AbortSignal` cancellation.

## Install

```sh
npm install retryflow-lite
```

Requires Node.js 18 or newer. CommonJS, native ESM, and TypeScript are supported.

## Quick start

```js
const { retry } = require('retryflow-lite');

async function main() {
  const result = await retry(async ({ attempt, signal }) => {
    const response = await fetch('https://api.example.com/data', { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} on attempt ${attempt}`);
    return response.json();
  }, {
    retries: 3,
    minDelayMs: 500,
    maxDelayMs: 5000,
    factor: 2,
    jitter: 'full'
  });
  console.log(result);
}

main().catch(console.error);
```

The first attempt is numbered `1`; `retries: 3` means up to four total attempts. Synchronous callbacks are accepted and the return value is always a Promise.

### ES modules

```js
import retry, { RetryError, retry as retryNamed } from 'retryflow-lite';

const value = await retryNamed(() => 'ready');
// `retry` is also the default export.
```

### TypeScript

```ts
import { retry, type RetryOptions } from 'retryflow-lite';

const options: RetryOptions = { retries: 2, minDelayMs: 100, jitter: 'equal' };
const value: string = await retry<string>(async ({ attempt }) => `done ${attempt}`, options);
```

## Backoff and jitter

The base delay after failure number `n` is `minDelayMs * factor ** (n - 1)`, capped at `maxDelayMs`. `jitter` can be:

- `none`: use the capped delay as-is.
- `full`: choose a random delay from zero through the capped delay.
- `equal`: choose a random delay from half the capped delay through the full capped delay.

Defaults are 3 retries, 100 ms minimum delay, 30,000 ms maximum delay, factor 2, and no jitter. Delays can be set to zero for fast deterministic flows.

## Conditional retries and hooks

```js
async function main() {
  return retry(callService, {
    retries: 5,
    shouldRetry: async (error, attempt) => error.code === 'ECONNRESET' && attempt < 4,
    onRetry: (error, { attempt, delayMs }) => {
      console.warn(`Retrying after attempt ${attempt} in ${delayMs} ms`, error);
    }
  });
}
```

`shouldRetry` may be synchronous or asynchronous. It runs after an operation failure when another attempt remains. Returning `false` stops immediately and throws the original operation error. If it returns a non-boolean value, a `TypeError` is rejected. `onRetry` runs after the predicate accepts and before the delay. Errors thrown by either hook are propagated.

## Timeout and cancellation

```js
const controller = new AbortController();
async function load() {
  return retry(({ signal }) => fetch(url, { signal }), {
    timeoutMs: 2_000,
    signal: controller.signal,
    retries: 2
  });
}
```

`timeoutMs` applies separately to each attempt. Each callback receives a per-attempt signal that is aborted when its timeout expires or the external signal aborts. A timeout rejects that attempt with `RetryTimeoutError`, so it can be retried. External cancellation stops the entire operation with `RetryAbortedError`, including when cancellation occurs during a backoff delay. An already-aborted external signal rejects without starting the callback.

A timeout can reject the attempt and abort its signal, but JavaScript cannot forcibly stop arbitrary work. Callbacks should pass the provided signal to APIs that support cancellation and otherwise arrange their own cleanup.

## Errors

- `RetryError` means all allowed attempts failed. Its `attempts` is the total number of attempts and its `cause` is the final operation error.
- `RetryTimeoutError` identifies the timed out `attempt` and `timeoutMs`.
- `RetryAbortedError` identifies cancellation and carries the external abort reason as `cause` when present.

An exhausted operation rejects with `RetryError`; a non-retryable operation rethrows the original operation error unchanged. Errors remain available through `cause` rather than being silently discarded.

## API reference

### `retry<T>(callback, options?)`

`callback` receives `{ attempt, signal }` and may return `T` or a promise-like value. `retry` resolves to that value or rejects with the operation error, a hook/configuration error, or one of the retry error classes.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `retries` | `number` | `3` | Additional attempts; non-negative safe integer. |
| `minDelayMs` | `number` | `100` | Initial delay, from zero through 2,147,483,647 ms. |
| `maxDelayMs` | `number` | `30000` | Delay cap, at least `minDelayMs` and at most 2,147,483,647 ms. |
| `factor` | `number` | `2` | Exponential multiplier, finite and at least `1`. |
| `jitter` | `'none' \| 'full' \| 'equal'` | `'none'` | Randomization strategy. |
| `timeoutMs` | `number` | — | Per-attempt timeout from 1 through 2,147,483,647 ms. |
| `signal` | `AbortSignal` | — | Cancel the whole retry operation. |
| `shouldRetry` | `(error, attempt) => boolean \| Promise<boolean>` | `() => true` | Decide whether to retry an operation error. |
| `onRetry` | `(error, { attempt, delayMs }) => void \| Promise<void>` | — | Observe an accepted retry before its delay. |

The package exports `retry` as a named export in both module systems and as the ESM default export. Error classes are named exports. TypeScript declarations are included.

## Examples

See [`examples/`](examples/) for a fetch example with cancellation and a database-style operation with selective retries.

## Limitations

RetryFlow cannot determine whether an operation is safe to repeat. Use it only for operations whose side effects are idempotent or otherwise protected against duplicates. Timeouts signal cancellation and reject promptly but cannot stop non-cooperative JavaScript work.

## License

MIT. See [LICENSE](LICENSE).
