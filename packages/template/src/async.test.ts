import { describe, expect, it } from "vitest";

import { isRetryableRpcError, withRetry, withTimeout } from "./async.js";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(
      withTimeout(Promise.resolve("done"), 1000, "too slow"),
    ).resolves.toBe("done");
  });

  it("rejects with the given message when the promise is too slow", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("too late"), 100);
    });
    await expect(withTimeout(slow, 5, "The network is slow.")).rejects.toThrow(
      "The network is slow.",
    );
  });

  it("passes through the promise's own rejection when it settles in time", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "too slow"),
    ).rejects.toThrow("boom");
  });
});

describe("isRetryableRpcError", () => {
  it("treats 429 and rate-limit messages as retryable", () => {
    expect(isRetryableRpcError(new Error("429 Too Many Requests"))).toBe(
      true,
    );
    expect(isRetryableRpcError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetryableRpcError(new Error("fetch failed"))).toBe(true);
  });

  it("treats other failures as not retryable", () => {
    expect(isRetryableRpcError(new Error("RPC is down"))).toBe(false);
    expect(isRetryableRpcError(new Error("Invalid public key"))).toBe(false);
    expect(isRetryableRpcError("a plain string")).toBe(false);
  });

  it("looks through a wrapping error's cause chain", () => {
    const wrapped = new Error("Could not reach the network, try again.", {
      cause: new Error("429 Too Many Requests"),
    });
    expect(isRetryableRpcError(wrapped)).toBe(true);
  });

  it("does not mistake a wrapped non-retryable error for a retryable one", () => {
    const wrapped = new Error("Could not reach the network, try again.", {
      cause: new Error("RPC is down"),
    });
    expect(isRetryableRpcError(wrapped)).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the first success without waiting", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve("done");
      },
      { sleep },
    );
    expect(result).toBe("done");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries a retryable failure with doubling delays, then succeeds", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new Error("429 Too Many Requests"));
        }
        return Promise.resolve("done");
      },
      { maxAttempts: 3, baseDelayMs: 250, sleep },
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 500]);
  });

  it("throws the last error after the attempts run out", async () => {
    const sleep = (): Promise<void> => Promise.resolve();
    await expect(
      withRetry(() => Promise.reject(new Error("fetch failed")), {
        maxAttempts: 2,
        sleep,
      }),
    ).rejects.toThrow("fetch failed");
  });

  it("does not retry a non-retryable failure", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      delays.push(ms);
    };
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new Error("Invalid public key"));
        },
        { maxAttempts: 3, sleep },
      ),
    ).rejects.toThrow("Invalid public key");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries a wrapped retryable error by looking at its cause", async () => {
    const sleep = (): Promise<void> => Promise.resolve();
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 2) {
          return Promise.reject(
            new Error("Could not reach the network, try again.", {
              cause: new Error("429 Too Many Requests"),
            }),
          );
        }
        return Promise.resolve("done");
      },
      { maxAttempts: 2, sleep },
    );
    expect(result).toBe("done");
    expect(calls).toBe(2);
  });
});
