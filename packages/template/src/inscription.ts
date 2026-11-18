import { PublicKey } from "@solana/web3.js";

/**
 * SPL-20-style inscription JSON: build, parse, and verify.
 *
 * An inscription is a JSON text record written on-chain in a transaction
 * memo. Skelsol inscriptions follow the SPL-20-style shape plus a `mint`
 * field that binds the inscription to its carrier NFT (see ADR 0002):
 *
 *   {"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"<mint address>"}
 *
 * This module is pure: no network access, no RPC calls.
 */

export interface InscriptionInput {
  /** The collection tick, 1-10 chars, [A-Z0-9]. */
  tick: string;
  /** A positive integer amount, as a string or a safe integer. */
  amt: string | number;
  /** The carrier NFT's mint address. */
  mint: string;
}

/** Machine-readable reason for an inscription rejection. */
export type InscriptionErrorReason =
  | "invalid-json"
  | "invalid-shape"
  | "invalid-protocol"
  | "unknown-operation"
  | "invalid-tick"
  | "invalid-amount"
  | "invalid-mint"
  | "tick-mismatch";

/** A clear, typed rejection of an inscription or its inputs. */
export class InscriptionError extends Error {
  readonly reason: InscriptionErrorReason;

  constructor(reason: InscriptionErrorReason, message: string) {
    super(message);
    this.name = "InscriptionError";
    this.reason = reason;
  }
}

/**
 * A tick is 1-10 uppercase letters or digits. The one canonical tick
 * pattern: the config module imports this instead of keeping its own
 * copy, so a tick means the same thing everywhere.
 */
export const TICK_PATTERN = /^[A-Z0-9]{1,10}$/;

function assertValidTick(tick: string): void {
  if (!TICK_PATTERN.test(tick)) {
    throw new InscriptionError(
      "invalid-tick",
      `Invalid tick "${tick}": a tick is 1-10 characters, uppercase letters and digits only.`,
    );
  }
}

const AMOUNT_PATTERN = /^[1-9][0-9]*$/;

function normalizeAmount(amt: string | number): string {
  if (typeof amt === "number") {
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      throw new InscriptionError(
        "invalid-amount",
        `Invalid amount "${amt}": the amount must be a positive integer.`,
      );
    }
    return String(amt);
  }
  if (!AMOUNT_PATTERN.test(amt)) {
    throw new InscriptionError(
      "invalid-amount",
      `Invalid amount "${amt}": the amount must be a positive integer, written as digits with no leading zero.`,
    );
  }
  return amt;
}

/**
 * A parsed SPL-20-style inscription record.
 */
export interface Inscription {
  p: "spl-20";
  op: "mint";
  tick: string;
  amt: string;
  mint: string;
}

/** The outcome of parsing inscription JSON. Never throws. */
export type ParseResult =
  | { ok: true; inscription: Inscription }
  | { ok: false; error: InscriptionError };

function requireStringField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new InscriptionError(
      "invalid-shape",
      `Invalid inscription: field "${field}" must be a string.`,
    );
  }
  return value;
}

/**
 * Parse inscription JSON from a memo.
 *
 * Accepts valid SPL-20-style JSON and returns the inscription record.
 * Rejects malformed JSON and invalid records with a reason, returned as
 * a failed result. This function never throws: a malformed memo is a
 * routine event for the reader, not a crash.
 */
export function parseInscription(json: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      error: new InscriptionError(
        "invalid-json",
        "Invalid inscription: the memo is not valid JSON.",
      ),
    };
  }
  try {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new InscriptionError(
        "invalid-shape",
        "Invalid inscription: the JSON must be an object.",
      );
    }
    const record = parsed as Record<string, unknown>;
    const p = requireStringField(record, "p");
    if (p !== "spl-20") {
      throw new InscriptionError(
        "invalid-protocol",
        `Invalid inscription: protocol "${p}" is not "spl-20".`,
      );
    }
    const op = requireStringField(record, "op");
    if (op !== "mint") {
      throw new InscriptionError(
        "unknown-operation",
        `Unknown operation "${op}": this release only supports "mint".`,
      );
    }
    const tick = requireStringField(record, "tick");
    const amt = requireStringField(record, "amt");
    const mint = requireStringField(record, "mint");
    assertValidTick(tick);
    normalizeAmount(amt);
    assertValidMint(mint);
    return {
      ok: true,
      inscription: { p: "spl-20", op: "mint", tick, amt, mint },
    };
  } catch (error) {
    if (error instanceof InscriptionError) {
      return { ok: false, error };
    }
    throw error;
  }
}

/** The outcome of verifying an inscription against a collection. Never throws. */
export type VerifyResult =
  | { ok: true }
  | { ok: false; error: InscriptionError };

/**
 * Verify the binding convention for a parsed inscription: the tick must
 * match the collection, and the `mint` field must be present and a
 * well-formed Solana address.
 *
 * This checks the inscription record only. Whether the memo and the NFT
 * mint are in the same transaction (the other half of the convention) is
 * the reader's job, because it needs the transaction.
 */
export function verifyInscription(
  inscription: Inscription,
  expectedTick: string,
): VerifyResult {
  if (inscription.tick !== expectedTick) {
    return {
      ok: false,
      error: new InscriptionError(
        "tick-mismatch",
        `Tick mismatch: the inscription is for "${inscription.tick}", not the "${expectedTick}" collection.`,
      ),
    };
  }
  try {
    assertValidMint(inscription.mint);
  } catch (error) {
    if (error instanceof InscriptionError) {
      return { ok: false, error };
    }
    throw error;
  }
  return { ok: true };
}

function assertValidMint(mint: string): void {
  try {
    new PublicKey(mint);
  } catch {
    throw new InscriptionError(
      "invalid-mint",
      `Invalid mint address "${mint}": the mint must be a well-formed Solana address.`,
    );
  }
}

/**
 * Build the canonical inscription JSON for a mint.
 *
 * The output is a single-line JSON string with fields in the fixed order
 * `p`, `op`, `tick`, `amt`, `mint`.
 *
 * Throws an {@link InscriptionError} when any input is invalid.
 */
export function buildInscription(input: InscriptionInput): string {
  assertValidTick(input.tick);
  const amt = normalizeAmount(input.amt);
  assertValidMint(input.mint);
  const inscription = {
    p: "spl-20",
    op: "mint",
    tick: input.tick,
    amt,
    mint: input.mint,
  };
  return JSON.stringify(inscription);
}
