'use strict';

const { retry } = require('retryflow-lite');

async function loadRecord(id) {
  return retry(({ attempt }) => database.load(id, { attempt }), {
    retries: 4,
    minDelayMs: 100,
    maxDelayMs: 1_000,
    jitter: 'full',
    shouldRetry: (error) => error.code === 'TEMPORARY_UNAVAILABLE',
    onRetry: (error, { attempt, delayMs }) => logger.warn({ error, attempt, delayMs }, 'Retrying record load')
  });
}

module.exports = { loadRecord };
