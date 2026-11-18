import retryflow = require('retryflow-lite');

const options: retryflow.RetryOptions = { retries: 1 };
const result: Promise<number> = retryflow.retry(({ attempt }) => attempt, options);
void [result, retryflow.RetryError, retryflow.RetryTimeoutError, retryflow.RetryAbortedError];
