import { describe, expect, it } from "vitest";

import { withTimeout } from "./async.js";

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
