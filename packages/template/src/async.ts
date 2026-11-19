/**
 * Small promise helpers shared by the template's callers.
 */

/**
 * Messages that mark an RPC failure as worth retrying: rate limiting
 * (429) or a dropped connection. Mirrors the reader's retry rule, so
 * both agree on what "transient" means.
 */
const RETRYABLE_RPC_MESSAGE =
  /429|rate.?limit|too many requests|fetch failed/i;

/**
 * Whether an RPC failure looks transient (rate limiting or a dropped
 * connection) and is worth retrying. Walks the error's `cause` chain,
 * because the template wraps raw RPC errors in plain-words errors
 * whose own message says nothing about the cause.
 */
export function isRetryableRpcError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof Error) {
      if (RETRYABLE_RPC_MESSAGE.test(current.message)) {
        return true;
      }
      current = current.cause;
    } else {
      return false;
    }
  }
  return false;
}

/** Options for {@link withRetry}. */
export interface RetryOptions {
  /**
   * Total attempts before giving up. Defaults to 3. Only
   * rate-limit-looking failures are retried (see
   * {@link isRetryableRpcError}); anything else fails after the first
   * try.
   */
  maxAttempts?: number;
  /**
   * Delay before the first retry, in milliseconds; each later retry
   * waits twice as long. Defaults to 250.
   */
  baseDelayMs?: number;
  /**
   * How to wait between retries. Defaults to a real timer; tests pass
   * a fake that records the delays instead of waiting, so no test
   * ever waits for real.
   */
  sleep?: (ms: number) => Promise<void>;
  /** Override for what counts as retryable. Defaults to {@link isRetryableRpcError}. */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Run `fn`, retrying rate-limit-looking failures with doubling delays
 * until it succeeds or the attempts run out. The last error is thrown
 * unchanged, so its `cause` chain survives for the caller to report.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 250;
  const sleep =
    options?.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  const isRetryable = options?.isRetryable ?? isRetryableRpcError;
  let delayMs = baseDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

/**
 * Race a promise against a deadline: resolve or reject with the
 * promise's own outcome when it settles in time, reject with an
 * Error carrying `message` when the deadline passes first. The
 * underlying promise keeps running (it cannot be cancelled); only
 * the caller stops waiting, so a slow network surfaces as an honest
 * error instead of a hang.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
