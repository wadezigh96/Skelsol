import { readFileSync } from "fs";

import { Keypair } from "@solana/web3.js";

/**
 * Load an agent wallet from a local keypair file. See GLOSSARY.md:
 * keypair file. The file holds a JSON array of 64 byte values (the
 * format `solana-keygen` writes). A missing or malformed file refuses
 * with a clear error; it never falls back to a default wallet.
 */

/** A clear, typed refusal to load a keypair file. */
export class KeypairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeypairError";
  }
}

/**
 * Load the keypair at `path`. Throws a {@link KeypairError} when the
 * file is missing, is not valid JSON, or is not a 64-byte secret-key
 * array.
 */
export function loadKeypairFromFile(path: string): Keypair {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new KeypairError(
      `Keypair file not found: "${path}". Pass an existing keypair file ` +
        `with --keypair <path>.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new KeypairError(
      `Keypair file "${path}" is not valid JSON: expected a JSON array ` +
        `of 64 byte values (the solana-keygen format).`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every(
      (value) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255,
    )
  ) {
    throw new KeypairError(
      `Keypair file "${path}" is not a valid Solana keypair: expected a ` +
        `JSON array of 64 byte values (the solana-keygen format).`,
    );
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } catch {
    throw new KeypairError(
      `Keypair file "${path}" is not a valid Solana keypair: the bytes ` +
        `do not form a valid secret key.`,
    );
  }
}
