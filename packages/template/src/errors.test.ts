import { describe, expect, it } from "vitest";

import { errorCauseMessage, withCause } from "./errors.js";

describe("errorCauseMessage", () => {
  it("returns the cause's message for a wrapped error", () => {
    const error = new Error("Could not reach the network, try again.", {
      cause: new Error("429 Too Many Requests"),
    });
    expect(errorCauseMessage(error)).toBe("429 Too Many Requests");
  });

  it("walks to the deepest cause", () => {
    const error = new Error("outer", {
      cause: new Error("middle", { cause: new Error("root cause") }),
    });
    expect(errorCauseMessage(error)).toBe("root cause");
  });

  it("returns null when there is no cause", () => {
    expect(errorCauseMessage(new Error("boom"))).toBeNull();
    expect(errorCauseMessage("a plain string")).toBeNull();
    expect(errorCauseMessage(null)).toBeNull();
  });

  it("truncates a long cause message", () => {
    const error = new Error("outer", {
      cause: new Error("x".repeat(200)),
    });
    expect(errorCauseMessage(error, 10)).toBe("xxxxxxxxxx…");
  });
});

describe("withCause", () => {
  it("appends the cause in parentheses when there is one", () => {
    const error = new Error("Could not reach the network, try again.", {
      cause: new Error("429 Too Many Requests"),
    });
    expect(withCause("Could not reach the market right now.", error)).toBe(
      "Could not reach the market right now. (429 Too Many Requests)",
    );
  });

  it("leaves the message untouched when there is no cause", () => {
    expect(withCause("Could not reach the market right now.", new Error("boom"))).toBe(
      "Could not reach the market right now.",
    );
  });
});
