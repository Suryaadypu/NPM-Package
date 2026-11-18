import retryDefault, { retry as namedRetry, RetryError, RetryTimeoutError, RetryAbortedError, type RetryOptions } from 'retryflow-lite';

const options: RetryOptions = {
  retries: 2,
  shouldRetry: async (error, attempt) => attempt < 2 && error instanceof Error,
  onRetry: (error, { attempt, delayMs }) => console.log(error, attempt, delayMs)
};
const result: Promise<number> = namedRetry(async ({ attempt, signal }) => {
  signal.throwIfAborted();
  return attempt;
}, options);
const defaultResult: Promise<string> = retryDefault(() => 'default');
void [result, defaultResult, RetryError, RetryTimeoutError, RetryAbortedError];
