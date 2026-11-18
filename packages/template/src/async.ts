/**
 * Small promise helpers shared by the template's callers.
 */

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
