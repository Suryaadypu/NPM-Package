import { retry, RetryAbortedError } from 'retryflow-lite';

const controller = new AbortController();
const stopAfter = setTimeout(() => controller.abort(new Error('Request cancelled')), 10_000);

try {
  const response = await retry(({ signal }) => fetch('https://api.github.com/repos/nodejs/node', { signal }), {
    retries: 3,
    minDelayMs: 250,
    maxDelayMs: 2_000,
    jitter: 'equal',
    timeoutMs: 4_000,
    signal: controller.signal,
    shouldRetry: (error) => error instanceof TypeError || error instanceof Error
  });
  console.log(await response.json());
} catch (error) {
  if (error instanceof RetryAbortedError) console.error('Request cancelled:', error.cause);
  else throw error;
} finally {
  clearTimeout(stopAfter);
}
