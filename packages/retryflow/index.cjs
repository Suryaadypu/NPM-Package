'use strict';

const MAX_TIMER_MS = 2 ** 31 - 1;
const RETRY_ABORT = Symbol('retryflow abort');

class RetryError extends Error {
  constructor(message, { attempts, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RetryError';
    this.attempts = attempts;
  }
}

class RetryTimeoutError extends Error {
  constructor(timeoutMs, attempt) {
    super(`Attempt ${attempt} timed out after ${timeoutMs} ms`);
    this.name = 'RetryTimeoutError';
    this.timeoutMs = timeoutMs;
    this.attempt = attempt;
  }
}

class RetryAbortedError extends Error {
  constructor(message = 'Retry operation was aborted', { attempt, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RetryAbortedError';
    this.attempt = attempt;
  }
}

function validate(callback, options) {
  if (typeof callback !== 'function') throw new TypeError('retry callback must be a function');
  if (options === undefined) options = {};
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('retry options must be an object');
  }
  const config = {
    retries: options.retries ?? 3,
    minDelayMs: options.minDelayMs ?? 100,
    maxDelayMs: options.maxDelayMs ?? 30_000,
    factor: options.factor ?? 2,
    jitter: options.jitter ?? 'none',
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    shouldRetry: options.shouldRetry ?? (() => true),
    onRetry: options.onRetry
  };
  if (!Number.isSafeInteger(config.retries) || config.retries < 0) throw new RangeError('retries must be a non-negative safe integer');
  for (const key of ['minDelayMs', 'maxDelayMs']) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new RangeError(`${key} must be a finite non-negative number`);
    if (config[key] > MAX_TIMER_MS) throw new RangeError(`${key} must not exceed ${MAX_TIMER_MS} ms`);
  }
  if (config.maxDelayMs < config.minDelayMs) throw new RangeError('maxDelayMs must be greater than or equal to minDelayMs');
  if (!Number.isFinite(config.factor) || config.factor < 1) throw new RangeError('factor must be a finite number greater than or equal to 1');
  if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > MAX_TIMER_MS)) {
    throw new RangeError(`timeoutMs must be a finite positive number no greater than ${MAX_TIMER_MS} ms`);
  }
  if (!['none', 'full', 'equal'].includes(config.jitter)) throw new TypeError('jitter must be "none", "full", or "equal"');
  if (typeof config.shouldRetry !== 'function') throw new TypeError('shouldRetry must be a function');
  if (config.onRetry !== undefined && typeof config.onRetry !== 'function') throw new TypeError('onRetry must be a function');
  if (config.signal !== undefined && (typeof config.signal !== 'object' || typeof config.signal.aborted !== 'boolean' ||
      typeof config.signal.addEventListener !== 'function' || typeof config.signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal');
  }
  return config;
}

function calculateDelay(failedAttempt, config, random = Math.random) {
  const ceiling = Math.min(config.maxDelayMs, config.minDelayMs * config.factor ** (failedAttempt - 1));
  if (config.jitter === 'full') return random() * ceiling;
  if (config.jitter === 'equal') return ceiling / 2 + random() * ceiling / 2;
  return ceiling;
}

function abortError(signal, attempt) {
  const error = new RetryAbortedError('Retry operation was aborted', { attempt, cause: signal?.reason });
  error[RETRY_ABORT] = true;
  return error;
}

function wait(delayMs, signal, attempt) {
  if (signal?.aborted) return Promise.reject(abortError(signal, attempt));
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(abortError(signal, attempt)); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    if (signal?.aborted) onAbort();
  });
}

async function runAttempt(callback, attempt, config) {
  const controller = new AbortController();
  let timeout;
  let externalAbort;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onExternalAbort = () => {
    rejectAbort(abortError(config.signal, attempt));
    controller.abort(config.signal.reason);
  };
  if (config.signal) {
    externalAbort = onExternalAbort;
    config.signal.addEventListener('abort', externalAbort, { once: true });
  }
  const operation = Promise.resolve().then(() => callback({ attempt, signal: controller.signal }));
  // Always observe the operation, including when timeout or cancellation wins the race.
  operation.catch(() => {});
  const racers = [operation, aborted];
  let timeoutReject;
  let timeoutPromise;
  if (config.timeoutMs !== undefined) {
    timeoutPromise = new Promise((_, reject) => { timeoutReject = reject; });
    timeout = setTimeout(() => {
      const error = new RetryTimeoutError(config.timeoutMs, attempt);
      timeoutReject(error);
      controller.abort(error);
    }, config.timeoutMs);
    racers.push(timeoutPromise);
  }
  try {
    if (config.signal?.aborted) onExternalAbort();
    return await Promise.race(racers);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (externalAbort) config.signal.removeEventListener('abort', externalAbort);
  }
}

async function retry(callback, options) {
  const config = validate(callback, options);
  let attempts = 0;
  for (let attempt = 1; attempt <= config.retries + 1; attempt += 1) {
    if (config.signal?.aborted) throw abortError(config.signal, attempts);
    attempts = attempt;
    try {
      return await runAttempt(callback, attempt, config);
    } catch (error) {
      if (error?.[RETRY_ABORT]) throw error;
      if (attempt > config.retries) {
        throw new RetryError(`Retry operation failed after ${attempt} attempts`, { attempts: attempt, cause: error });
      }
      const canRetry = await config.shouldRetry(error, attempt);
      if (typeof canRetry !== 'boolean') throw new TypeError('shouldRetry must return a boolean');
      if (!canRetry) throw error;
      const delayMs = calculateDelay(attempt, config);
      if (config.onRetry) await config.onRetry(error, { attempt, delayMs });
      await wait(delayMs, config.signal, attempt);
    }
  }
  throw new Error('Unreachable retry state');
}

module.exports = { retry, RetryError, RetryTimeoutError, RetryAbortedError };
