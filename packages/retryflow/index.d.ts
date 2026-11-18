/// <reference lib="es2022" />

export interface RetryContext {
  /** One-based attempt number. */
  attempt: number;
  /** Per-attempt signal, aborted on timeout or external cancellation. */
  signal: AbortSignal;
}

export type RetryCallback<T> = (context: RetryContext) => T | PromiseLike<T>;
export type JitterMode = 'none' | 'full' | 'equal';

export interface RetryOptions {
  /** Additional attempts after the first; defaults to 3. */
  retries?: number;
  /** Initial delay in milliseconds; defaults to 100. */
  minDelayMs?: number;
  /** Delay ceiling in milliseconds; defaults to 30000. */
  maxDelayMs?: number;
  /** Exponential multiplier, at least 1; defaults to 2. */
  factor?: number;
  /** Delay randomization mode; defaults to 'none'. */
  jitter?: JitterMode;
  /** Maximum duration of one attempt in milliseconds. */
  timeoutMs?: number;
  /** Cancels the whole retry operation. */
  signal?: AbortSignal;
  /** Return true to allow a retry after this error. */
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>;
  /** Called before the delay preceding the next attempt. */
  onRetry?: (error: unknown, context: { attempt: number; delayMs: number }) => void | Promise<void>;
}

export class RetryError extends Error {
  readonly attempts: number;
  override readonly cause?: unknown;
  constructor(message: string, options?: { attempts?: number; cause?: unknown });
}
export class RetryTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly attempt: number;
  constructor(timeoutMs: number, attempt: number);
}
export class RetryAbortedError extends Error {
  readonly attempt?: number;
  override readonly cause?: unknown;
  constructor(message?: string, options?: { attempt?: number; cause?: unknown });
}

export function retry<T>(callback: RetryCallback<T>, options?: RetryOptions): Promise<T>;
export default retry;
