import test from 'node:test';
import assert from 'node:assert/strict';
import retry, { retry as namedRetry, RetryError } from 'retryflow-lite';

test('ESM named and default exports work', async () => {
  assert.equal(await namedRetry(() => 7), 7);
  assert.equal(await retry(() => 8), 8);
  assert.equal(typeof RetryError, 'function');
});
