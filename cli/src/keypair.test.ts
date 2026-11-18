import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Keypair } from "@solana/web3.js";
import { afterAll, describe, expect, it } from "vitest";

import { KeypairError, loadKeypairFromFile } from "./keypair.js";

const dir = mkdtempSync(join(tmpdir(), "skel-keypair-test-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeKeypairFile(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe("loadKeypairFromFile", () => {
  it("loads a valid 64-byte secret-key JSON array", () => {
    const keypair = Keypair.generate();
    const path = writeKeypairFile(
      "valid.json",
      JSON.stringify([...keypair.secretKey]),
    );
    const loaded = loadKeypairFromFile(path);
    expect(loaded.publicKey.toBase58()).toBe(
      keypair.publicKey.toBase58(),
    );
  });

  it("refuses a missing file with a clear error", () => {
    const path = join(dir, "does-not-exist.json");
    expect(() => loadKeypairFromFile(path)).toThrow(KeypairError);
    expect(() => loadKeypairFromFile(path)).toThrow(
      /keypair file not found/i,
    );
  });

  it("refuses a file that is not valid JSON", () => {
    const path = writeKeypairFile("not-json.json", "this is not json");
    expect(() => loadKeypairFromFile(path)).toThrow(KeypairError);
    expect(() => loadKeypairFromFile(path)).toThrow(/not valid JSON/i);
  });

  it("refuses a JSON value that is not a 64-byte array", () => {
    const short = writeKeypairFile("short.json", JSON.stringify([1, 2, 3]));
    expect(() => loadKeypairFromFile(short)).toThrow(
      /expected a JSON array of 64 byte values/i,
    );
    const object = writeKeypairFile("object.json", JSON.stringify({ a: 1 }));
    expect(() => loadKeypairFromFile(object)).toThrow(
      /expected a JSON array of 64 byte values/i,
    );
  });

  it("refuses byte values outside 0-255", () => {
    const bytes = new Array<number>(64).fill(0);
    bytes[0] = 256;
    const path = writeKeypairFile("bad-byte.json", JSON.stringify(bytes));
    expect(() => loadKeypairFromFile(path)).toThrow(
      /expected a JSON array of 64 byte values/i,
    );
  });
});
