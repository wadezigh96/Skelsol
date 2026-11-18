import { Readable, Writable } from "stream";

import { describe, expect, it } from "vitest";

import { askConfirmation, isYes } from "./confirm.js";

describe("isYes", () => {
  it("accepts exactly yes and y, case-insensitive, with surrounding space", () => {
    for (const answer of ["yes", "YES", "Yes", "y", "Y", "  yes  "]) {
      expect(isYes(answer)).toBe(true);
    }
  });

  it("rejects anything else, including yes-like words", () => {
    for (const answer of [
      "",
      "no",
      "n",
      "yeah",
      "yep",
      "ok",
      "yes please",
      "confirm",
    ]) {
      expect(isYes(answer)).toBe(false);
    }
  });
});

describe("askConfirmation", () => {
  it("returns true when the user types yes", async () => {
    const input = Readable.from(["yes\n"]);
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    await expect(
      askConfirmation("Send this transaction? ", input, output),
    ).resolves.toBe(true);
  });

  it("returns false when the user types anything else", async () => {
    const input = Readable.from(["no\n"]);
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    await expect(
      askConfirmation("Send this transaction? ", input, output),
    ).resolves.toBe(false);
  });

  it("writes the prompt to the output stream (stderr in the real CLI)", async () => {
    const input = Readable.from(["yes\n"]);
    const written: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        written.push(chunk.toString());
        done();
      },
    });
    await askConfirmation("Type yes to confirm: ", input, output);
    expect(written.join("")).toContain("Type yes to confirm: ");
  });
});
