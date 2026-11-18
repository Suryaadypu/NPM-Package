'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retry, RetryError, RetryTimeoutError, RetryAbortedError } = require('retryflow-lite');

const fast = { retries: 2, minDelayMs: 0, maxDelayMs: 0 };

test('succeeds on the first attempt and supports sync and async callbacks', async () => {
  assert.equal(await retry(() => 42), 42);
  assert.equal(await retry(async () => 'ok'), 'ok');
});

test('retries failures and numbers attempts from one', async () => {
  let calls = 0;
  const result = await retry(({ attempt }) => {
    assert.equal(attempt, ++calls);
    if (calls < 3) throw new Error('temporary');
    return 'success';
  }, fast);
  assert.equal(result, 'success');
  assert.equal(calls, 3);
});

test('exhaustion wraps the final error and counts total attempts', async () => {
  const failure = new Error('broken');
  await assert.rejects(retry(() => { throw failure; }, { ...fast, retries: 1 }), (error) => {
    assert.ok(error instanceof RetryError);
    assert.equal(error.attempts, 2);
    assert.equal(error.cause, failure);
    return true;
  });
});

test('zero retries performs exactly one attempt', async () => {
  let calls = 0;
  await assert.rejects(retry(() => { calls += 1; throw Error('x'); }, { retries: 0 }), RetryError);
  assert.equal(calls, 1);
});

test('non-retryable errors are preserved', async () => {
  const failure = Error('no');
  await assert.rejects(retry(() => { throw failure; }, { ...fast, shouldRetry: () => false }), (error) => error === failure);
});

test('a callback-thrown RetryAbortedError is treated as an operation error', async () => {
  let calls = 0;
  const result = await retry(() => {
    if (++calls === 1) throw new RetryAbortedError('callback error');
    return 'recovered';
  }, { ...fast, shouldRetry: () => true });
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('supports asynchronous retry predicates and onRetry callback', async () => {
  let calls = 0;
  const events = [];
  assert.equal(await retry(() => { if (++calls === 1) throw Error('temp'); return 9; }, {
    ...fast,
    shouldRetry: async () => true,
    onRetry: async (error, context) => events.push([error.message, context.attempt, context.delayMs])
  }), 9);
  assert.deepEqual(events, [['temp', 1, 0]]);
});

test('reports capped exponential delays before each retry', async () => {
  const delays = [];
  const stop = Error('stop before sleeping');
  await assert.rejects(retry(() => { throw Error('temporary'); }, {
    retries: 4,
    minDelayMs: 100,
    maxDelayMs: 250,
    factor: 2,
    onRetry: (_error, { delayMs }) => {
      delays.push(delayMs);
      if (delays.length === 3) throw stop;
    }
  }), (error) => error === stop);
  assert.deepEqual(delays, [100, 200, 250]);
});

test('full and equal jitter stay within their documented ranges', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    for (const [jitter, expected] of [['full', 50], ['equal', 75]]) {
      let delay;
      await assert.rejects(retry(() => { throw Error('temporary'); }, {
        retries: 1,
        minDelayMs: 100,
        maxDelayMs: 100,
        jitter,
        onRetry: (_error, context) => { delay = context.delayMs; throw Error('stop'); }
      }), /stop/);
      assert.equal(delay, expected);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('timeout aborts the attempt signal and can be retried', async () => {
  let calls = 0;
  const result = await retry(({ signal }) => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => signal.addEventListener('abort', () => resolve('late')));
    return 'done';
  }, { ...fast, timeoutMs: 10 });
  assert.equal(result, 'done');
  assert.equal(calls, 2);
});

test('final timeout is exposed as RetryError with RetryTimeoutError cause', async () => {
  await assert.rejects(retry(() => new Promise(() => {}), { retries: 0, timeoutMs: 5 }), (error) => {
    assert.ok(error instanceof RetryError);
    assert.ok(error.cause instanceof RetryTimeoutError);
    assert.equal(error.cause.attempt, 1);
    return true;
  });
});

test('timeout error wins when the callback rejects in response to timeout abort', async () => {
  await assert.rejects(retry(({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }), { retries: 0, timeoutMs: 5 }), (error) => {
    assert.ok(error instanceof RetryError);
    assert.ok(error.cause instanceof RetryTimeoutError);
    return true;
  });
});

test('clears the per-attempt timeout after success', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled = 0;
  let cleared = 0;
  globalThis.setTimeout = (...args) => { scheduled += 1; return originalSetTimeout(...args); };
  globalThis.clearTimeout = (timer) => { cleared += 1; return originalClearTimeout(timer); };
  try {
    assert.equal(await retry(() => 'ok', { timeoutMs: 100 }), 'ok');
    assert.equal(scheduled, 1);
    assert.equal(cleared, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('external abort stops an attempt and preserves the reason', async () => {
  const controller = new AbortController();
  const reason = Error('stop');
  const pending = retry(({ signal }) => new Promise((resolve) => signal.addEventListener('abort', resolve)), { ...fast, signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error instanceof RetryAbortedError && error.cause === reason);
});

test('already-aborted signals skip the callback', async () => {
  const controller = new AbortController();
  controller.abort('done');
  let calls = 0;
  await assert.rejects(retry(() => { calls += 1; }, { signal: controller.signal }), RetryAbortedError);
  assert.equal(calls, 0);
});

test('cancellation during a retry delay rejects and does not begin another attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = retry(() => { calls += 1; throw Error('temp'); }, { retries: 2, minDelayMs: 1000, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, RetryAbortedError);
  assert.equal(calls, 1);
});

test('removes abort listeners when an attempt is cancelled', async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  let added = 0;
  let removed = 0;
  signal.addEventListener = (...args) => { if (args[0] === 'abort') added += 1; return add(...args); };
  signal.removeEventListener = (...args) => { if (args[0] === 'abort') removed += 1; return remove(...args); };
  const pending = retry(({ signal: attemptSignal }) => new Promise((resolve) => attemptSignal.addEventListener('abort', resolve)), {
    retries: 1,
    minDelayMs: 0,
    signal
  });
  controller.abort();
  await assert.rejects(pending, RetryAbortedError);
  assert.equal(added, removed);
});

test('validates callback, options, and option values through promise rejection', async () => {
  await assert.rejects(retry(null), TypeError);
  await assert.rejects(retry(() => 1, { retries: -1 }), RangeError);
  await assert.rejects(retry(() => 1, { jitter: 'bad' }), TypeError);
  await assert.rejects(retry(() => 1, { timeoutMs: 0 }), RangeError);
  await assert.rejects(retry(() => 1, { shouldRetry: true }), TypeError);
});

test('CJS entry point exports expected API', () => {
  assert.equal(typeof retry, 'function');
  assert.equal(typeof RetryError, 'function');
});
