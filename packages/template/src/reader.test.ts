import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  GHOST_COLLECTION,
  loadCollectionConfig,
  MEMO_PROGRAM_ID,
  type CollectionConfig,
} from "./config.js";
import {
  getActivity,
  getCollectionOverview,
  getCollectionState,
  getLeaderboard,
  getMintLimits,
  lookupWallet,
  ReaderError,
  toReaderConnection,
  type ParsedTransactionConnection,
  type ReaderConnection,
  type ReaderSignatureInfo,
  type ReaderTransaction,
} from "./reader.js";

// Type-level checks (no runtime code): a real jsonParsed transaction and
// signature info fit the reader's shapes, so a real Connection adapts by
// wrapping getParsedTransaction and getSignaturesForAddress. If either
// shape ever stops fitting, tsc fails here.
type AssertAssignable<Expected, Actual extends Expected> = Actual;
type _ParsedTxFitsReader = AssertAssignable<
  ReaderTransaction,
  ParsedTransactionWithMeta
>;
type _SignatureInfoFitsReader = AssertAssignable<
  ReaderSignatureInfo,
  ConfirmedSignatureInfo
>;
// A real web3.js Connection satisfies the parsed-connection shape, so
// toReaderConnection accepts it directly. If the Connection API ever
// drifts, tsc fails here.
type _ConnectionFitsParsedConnection = AssertAssignable<
  ParsedTransactionConnection,
  Connection
>;

const ALICE = "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg";
const BOB = "EktykAoVcmRxohrpg1yyD9QFxyZZd3UxP3y4CyjSWKdn";
const CAROL = "7vMsoZRygqVxq2qY4xJYzR4Z6bWc8Qe9kL3mN2pP5qR7";
const MINT_ALICE_1 = "2X1DLFAj9WLZXbyykDryC9bLuXRyBwM4dNrpTPFBafA2";
const MINT_ALICE_2 = "BJqA9SwtvGewsRZBrjL4U68Yat7VUGXzFc1crhWk6Ce7";
const MINT_BOB_1 = "Ep8XGRY4REcePCVy2Rk9QYcME5Jsk5W3rLGMykcWeB7G";
const SIG_ALICE_1 =
  "ZkJQg4RcWfhNyPg6tZ2FUxBjp6tUxFKDixMpiaGBqD6gkoFNq8axKY4YiLztKcNG3nvhGLPKvoAoDWw4EZKAnRd";
const SIG_ALICE_2 =
  "5TaRXMRS7XWX2RFpRNErgTumLzxfuwuZrC5htrbU5PEqzMAMUz7NeBGXEkNN4Q7yL7vuKmbk9cpXPLLQzifNdNW9";
const SIG_BOB_1 =
  "4XTuPVXvapJKwwYh2S2qa29hcK6ZsagstbYi8hXdoApDCXZzG5V6NEpLnG2cDiYBVoQ8gsQDX91KHmvJG6gpyGwq";
/** The first live devnet mint, registered on GHOST_COLLECTION (ADR 0015). */
const SIG_GHOST_FIRST_MINT =
  "4LS2AsdKr3KvgzBEM8WW9zE6RBW5fXcT5qtJruZHiNtgdo5o6V1FYKwpgXWrvrY7LisRmJdxWo3JhmmLg4t8H85F";

/** All fixtures, newest first, the way getSignaturesForAddress returns them. */
const ALL_FIXTURES = [
  "failed-mint.json",
  "unverified-mint.json",
  "no-memo.json",
  "wrong-tick-memo.json",
  "malformed-memo.json",
  "mint-alice-2.json",
  "mint-bob-1.json",
  "mint-alice-1.json",
];

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** The raw shape of a fixture file on disk. */
interface FixtureFile {
  signature: string;
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    logMessages: string[] | null;
    preTokenBalances: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
    }> | null;
    postTokenBalances: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
    }> | null;
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
    };
    signatures: string[];
  };
}

/** Load one fixture and shape it like a jsonParsed transaction. */
function loadFixture(name: string): {
  signature: string;
  transaction: ReaderTransaction;
} {
  const raw = JSON.parse(
    readFileSync(join(FIXTURES_DIR, name), "utf8"),
  ) as FixtureFile;
  return {
    signature: raw.signature,
    transaction: {
      slot: raw.slot,
      blockTime: raw.blockTime,
      meta:
        raw.meta === null
          ? null
          : {
              err: raw.meta.err,
              logMessages: raw.meta.logMessages,
              preTokenBalances: raw.meta.preTokenBalances,
              postTokenBalances: raw.meta.postTokenBalances,
            },
      transaction: {
        signatures: raw.transaction.signatures,
        message: {
          accountKeys: raw.transaction.message.accountKeys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            signer: key.signer,
            writable: key.writable,
          })),
        },
      },
    },
  };
}

/** A Connection-like fake backed by recorded fixture transactions. */
class FakeConnection implements ReaderConnection {
  private readonly transactions = new Map<string, ReaderTransaction>();
  private readonly order: string[] = [];
  /** Addresses getSignaturesForAddress was called with. */
  readonly queriedAddresses: PublicKey[] = [];
  /** Signatures getTransaction was called with, in call order. */
  readonly fetchedSignatures: string[] = [];
  /** When set, getSignaturesForAddress throws this error. */
  signaturesError: unknown = null;
  /** Signatures whose fetch throws, and the error to throw. */
  readonly fetchErrors = new Map<string, unknown>();
  /**
   * Signatures whose fetch throws `error` while `remaining` is above
   * zero, then succeeds: a flaky RPC that rate-limits, then relents.
   */
  readonly flakyFetches = new Map<
    string,
    { remaining: number; error: unknown }
  >();

  constructor(fixtureNames: string[]) {
    for (const name of fixtureNames) {
      this.addFixture(name);
    }
  }

  /** Add a fixture's transaction, as if a new mint landed on chain. */
  addFixture(name: string): void {
    const { signature, transaction } = loadFixture(name);
    this.transactions.set(signature, transaction);
    this.order.push(signature);
  }

  /**
   * Add a transaction fetchable by signature but outside the live
   * window (it never appears in getSignaturesForAddress results), as
   * if its mint aged out of the memo scan: the registry's job is to
   * find exactly these.
   */
  addOffWindowTransaction(
    signature: string,
    transaction: ReaderTransaction,
  ): void {
    this.transactions.set(signature, transaction);
  }

  /** Add a signature whose transaction is gone (pruned), like live RPC. */
  addPrunedSignature(signature: string): void {
    this.order.push(signature);
  }

  /**
   * Add a raw transaction under a signature of the caller's choosing,
   * as if a second transaction carried the same content (a duplicate
   * mint). The reader never cross-checks the transaction's own
   * signature list against the signature it was fetched under.
   */
  addRawTransaction(
    signature: string,
    transaction: ReaderTransaction,
  ): void {
    this.transactions.set(signature, transaction);
    this.order.push(signature);
  }

  async getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number },
  ): Promise<ReaderSignatureInfo[]> {
    this.queriedAddresses.push(address);
    if (this.signaturesError !== null) {
      throw this.signaturesError;
    }
    const limit = options?.limit ?? this.order.length;
    return this.order.slice(0, limit).map((signature) => {
      const tx = this.transactions.get(signature);
      return {
        signature,
        slot: tx?.slot ?? 0,
        err: tx?.meta?.err ?? null,
        blockTime: tx?.blockTime ?? null,
      };
    });
  }

  async getTransaction(signature: string): Promise<ReaderTransaction | null> {
    this.fetchedSignatures.push(signature);
    const flaky = this.flakyFetches.get(signature);
    if (flaky !== undefined && flaky.remaining > 0) {
      flaky.remaining -= 1;
      throw flaky.error;
    }
    const error = this.fetchErrors.get(signature);
    if (error !== undefined) {
      throw error;
    }
    return this.transactions.get(signature) ?? null;
  }
}

describe("getCollectionState", () => {
  it("counts minted, remaining, and holders from on-chain records", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state).toEqual({
      tick: "GHOST",
      supply: 4444,
      minted: 3,
      remaining: 4441,
      holders: 2,
      malformedMemos: 1,
      unverifiedInscriptions: 1,
      // 8 live signatures plus the registered first mint, whose
      // transaction is not in the fake (pruned): examined, skipped.
      scanned: 9,
      failedFetches: 0,
      fromRegistry: 0,
    });
  });

  it("returns zeros for an empty collection", async () => {
    const connection = new FakeConnection([]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state).toEqual({
      tick: "GHOST",
      supply: 4444,
      minted: 0,
      remaining: 4444,
      holders: 0,
      malformedMemos: 0,
      unverifiedInscriptions: 0,
      // No live signatures, but the registered first mint is still
      // examined (its transaction is not in the fake: pruned).
      scanned: 1,
      failedFetches: 0,
      fromRegistry: 0,
    });
  });

  it("scans the memo program address for transactions", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    await getCollectionState(connection, GHOST_COLLECTION);
    expect(connection.queriedAddresses).toHaveLength(1);
    expect(connection.queriedAddresses[0]?.toBase58()).toBe(MEMO_PROGRAM_ID);
  });

  it("respects the scan limit", async () => {
    // Newest first: the first two fixtures are the failed mint and the
    // unverified mint, so a scan of two finds no verified inscriptions.
    const connection = new FakeConnection(ALL_FIXTURES);
    const state = await getCollectionState(connection, GHOST_COLLECTION, {
      scanLimit: 2,
    });
    expect(state.minted).toBe(0);
    expect(state.unverifiedInscriptions).toBe(1);
    expect(state.malformedMemos).toBe(0);
  });

  it("skips a transaction whose fetch returns null", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    connection.addPrunedSignature(SIG_BOB_1);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state.minted).toBe(1);
    expect(state.holders).toBe(1);
  });

  it("skips a transaction whose fetch fails, counts it, and keeps reading", async () => {
    const connection = new FakeConnection([
      "mint-alice-1.json",
      "mint-bob-1.json",
    ]);
    connection.fetchErrors.set(SIG_BOB_1, new Error("boom"));
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state.minted).toBe(1);
    expect(state.failedFetches).toBe(1);
    // Two live signatures plus the registered first mint (pruned here).
    expect(state.scanned).toBe(3);
  });

  it("turns an RPC failure into a plain-words reader error", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    connection.signaturesError = new Error("fetch failed");
    await expect(
      getCollectionState(connection, GHOST_COLLECTION),
    ).rejects.toBeInstanceOf(ReaderError);
    await expect(
      getCollectionState(connection, GHOST_COLLECTION),
    ).rejects.toMatchObject({
      reason: "rpc-error",
      message: expect.stringMatching(/could not reach the network/i),
    });
  });

  it("keeps the underlying RPC error as the cause", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const rpcError = new Error("fetch failed");
    connection.signaturesError = rpcError;
    try {
      await getCollectionState(connection, GHOST_COLLECTION);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ReaderError);
      expect((error as ReaderError).cause).toBe(rpcError);
    }
  });
});

describe("known-inscription registry", () => {
  /** GHOST_COLLECTION with the registry replaced by the given signatures. */
  const configWithRegistry = (signatures: string[]): CollectionConfig =>
    loadCollectionConfig({ ...GHOST_COLLECTION, knownInscriptions: signatures });

  it("finds a registered mint that aged out of the live window", async () => {
    const connection = new FakeConnection(["no-memo.json"]);
    const { transaction } = loadFixture("mint-alice-1.json");
    connection.addOffWindowTransaction(SIG_ALICE_1, transaction);
    const config = configWithRegistry([SIG_ALICE_1]);

    const state = await getCollectionState(connection, config);

    expect(state.minted).toBe(1);
    expect(state.holders).toBe(1);
    expect(state.fromRegistry).toBe(1);
    // One live signature plus one registered signature examined.
    expect(state.scanned).toBe(2);
    expect(state.failedFetches).toBe(0);
  });

  it("does not double-count a registered mint still in the live window", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    const config = configWithRegistry([SIG_ALICE_1]);

    const state = await getCollectionState(connection, config);

    expect(state.minted).toBe(1);
    expect(state.fromRegistry).toBe(0);
    // Fetched once, through the live scan; the registry did not refetch it.
    expect(connection.fetchedSignatures).toEqual([SIG_ALICE_1]);
  });

  it("skips a malformed registered transaction and counts it", async () => {
    const connection = new FakeConnection([]);
    const { signature, transaction } = loadFixture("malformed-memo.json");
    connection.addOffWindowTransaction(signature, transaction);
    const config = configWithRegistry([signature]);

    const state = await getCollectionState(connection, config);

    expect(state.minted).toBe(0);
    expect(state.malformedMemos).toBe(1);
    expect(state.fromRegistry).toBe(0);
  });

  it("excludes a registered inscription whose binding cannot be verified", async () => {
    const connection = new FakeConnection([]);
    const { signature, transaction } = loadFixture("unverified-mint.json");
    connection.addOffWindowTransaction(signature, transaction);
    const config = configWithRegistry([signature]);

    const state = await getCollectionState(connection, config);

    expect(state.minted).toBe(0);
    expect(state.unverifiedInscriptions).toBe(1);
    expect(state.fromRegistry).toBe(0);
  });

  it("skips a pruned registered signature without failing", async () => {
    const connection = new FakeConnection([]);
    const config = configWithRegistry([SIG_ALICE_1]);

    const state = await getCollectionState(connection, config);

    expect(state.minted).toBe(0);
    expect(state.failedFetches).toBe(0);
    expect(state.scanned).toBe(1);
  });

  it("counts a registered fetch failure and keeps reading", async () => {
    const connection = new FakeConnection(["no-memo.json"]);
    const { transaction } = loadFixture("mint-alice-1.json");
    connection.addOffWindowTransaction(SIG_ALICE_1, transaction);
    connection.fetchErrors.set(SIG_ALICE_1, new Error("429 Too Many Requests"));
    const config = configWithRegistry([SIG_ALICE_1]);

    const state = await getCollectionState(connection, config, {
      sleep: async () => {},
    });

    expect(state.minted).toBe(0);
    expect(state.failedFetches).toBe(1);
  });

  it("a registered mint appears in lookup, leaderboard, and mint limits", async () => {
    const connection = new FakeConnection(["no-memo.json"]);
    const { transaction } = loadFixture("mint-alice-1.json");
    connection.addOffWindowTransaction(SIG_ALICE_1, transaction);
    const config = configWithRegistry([SIG_ALICE_1]);

    const found = await lookupWallet(connection, config, ALICE);
    expect(found).toHaveLength(1);
    expect(found[0]?.mint).toBe(MINT_ALICE_1);
    expect(found[0]?.signature).toBe(SIG_ALICE_1);

    const leaderboard = await getLeaderboard(connection, config);
    expect(leaderboard).toEqual([{ wallet: ALICE, count: 1 }]);

    const limits = await getMintLimits(connection, config, ALICE);
    expect(limits.minted).toBe(1);
    expect(limits.mintedByWallet).toBe(1);
    expect(limits.canMint).toBe(true);
  });
});

describe("fetch retries", () => {
  it("retries a rate-limited fetch with growing delays and succeeds", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    connection.flakyFetches.set(SIG_ALICE_1, {
      remaining: 2,
      error: new Error("429 Too Many Requests"),
    });
    const delays: number[] = [];
    const state = await getCollectionState(connection, GHOST_COLLECTION, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(state.minted).toBe(1);
    expect(state.failedFetches).toBe(0);
    // The flaky mint is fetched three times (two retries), then the
    // registered first mint is fetched once (pruned in this fake).
    expect(connection.fetchedSignatures).toEqual([
      SIG_ALICE_1,
      SIG_ALICE_1,
      SIG_ALICE_1,
      SIG_GHOST_FIRST_MINT,
    ]);
    expect(delays).toEqual([250, 500]);
  });

  it("gives up after the retry budget and counts the fetch as failed", async () => {
    const connection = new FakeConnection([
      "mint-alice-1.json",
      "mint-bob-1.json",
    ]);
    connection.fetchErrors.set(SIG_BOB_1, new Error("429 Too Many Requests"));
    const delays: number[] = [];
    const state = await getCollectionState(connection, GHOST_COLLECTION, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(state.minted).toBe(1);
    expect(state.failedFetches).toBe(1);
    expect(
      connection.fetchedSignatures.filter((sig) => sig === SIG_BOB_1),
    ).toHaveLength(3);
    expect(delays).toEqual([250, 500]);
  });

  it("does not retry a failure that does not look like rate limiting", async () => {
    const connection = new FakeConnection([
      "mint-alice-1.json",
      "mint-bob-1.json",
    ]);
    connection.fetchErrors.set(SIG_BOB_1, new Error("boom"));
    const delays: number[] = [];
    const state = await getCollectionState(connection, GHOST_COLLECTION, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(state.minted).toBe(1);
    expect(state.failedFetches).toBe(1);
    expect(
      connection.fetchedSignatures.filter((sig) => sig === SIG_BOB_1),
    ).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it("respects a custom retry budget", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    connection.fetchErrors.set(SIG_ALICE_1, new Error("429 Too Many Requests"));
    const delays: number[] = [];
    const state = await getCollectionState(connection, GHOST_COLLECTION, {
      maxFetchAttempts: 1,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(state.minted).toBe(0);
    expect(state.failedFetches).toBe(1);
    // One attempt for the flaky mint (no retries), then one fetch for
    // the registered first mint (pruned in this fake).
    expect(connection.fetchedSignatures).toEqual([
      SIG_ALICE_1,
      SIG_GHOST_FIRST_MINT,
    ]);
    expect(delays).toEqual([]);
  });
});

/** Wait until a condition holds, or fail after the timeout. */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A fake whose fetches all wait on one gate, tracking in-flight count. */
class GatedConnection extends FakeConnection {
  inFlight = 0;
  maxInFlight = 0;
  private releaseGate: () => void = () => {};
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  override async getTransaction(
    signature: string,
  ): Promise<ReaderTransaction | null> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.gate;
      return await super.getTransaction(signature);
    } finally {
      this.inFlight -= 1;
    }
  }

  releaseAll(): void {
    this.releaseGate();
  }
}

/** A fake whose fetches wait on a per-signature gate, released by hand. */
class OrderReleasingConnection extends FakeConnection {
  private readonly gates = new Map<string, () => void>();

  override async getTransaction(
    signature: string,
  ): Promise<ReaderTransaction | null> {
    await new Promise<void>((resolve) => {
      this.gates.set(signature, resolve);
    });
    return super.getTransaction(signature);
  }

  /** How many fetches are currently waiting on their gate. */
  get pendingFetches(): number {
    return this.gates.size;
  }

  release(signature: string): void {
    this.gates.get(signature)?.();
  }
}

describe("parallel fetches", () => {
  it("fetches transactions concurrently, bounded by fetchConcurrency", async () => {
    const connection = new GatedConnection(ALL_FIXTURES);
    const pending = getCollectionState(connection, GHOST_COLLECTION, {
      fetchConcurrency: 3,
    });
    // The pool fills before any fetch completes: the gate holds all three.
    await waitFor(() => connection.maxInFlight >= 3);
    expect(connection.maxInFlight).toBeLessThanOrEqual(3);
    connection.releaseAll();
    const state = await pending;
    expect(connection.maxInFlight).toBeLessThanOrEqual(3);
    expect(state.minted).toBe(3);
    expect(state.failedFetches).toBe(0);
  });

  it("keeps the newest record for a duplicate mint even when the older fetch finishes first", async () => {
    const { transaction } = loadFixture("mint-alice-1.json");
    const connection = new OrderReleasingConnection([]);
    connection.addRawTransaction(SIG_ALICE_1, transaction);
    connection.addRawTransaction(SIG_ALICE_2, transaction);
    const pending = getActivity(connection, GHOST_COLLECTION);
    await waitFor(() => connection.pendingFetches >= 2);
    // The older fetch finishes first; the scan must still keep the newest.
    connection.release(SIG_ALICE_2);
    connection.release(SIG_ALICE_1);
    // The registry fetch gates next (a third gate); release it too, or
    // the scan never finishes.
    await waitFor(() => connection.pendingFetches >= 3);
    connection.release(SIG_GHOST_FIRST_MINT);
    const activity = await pending;
    expect(activity).toHaveLength(1);
    expect(activity[0]?.signature).toBe(SIG_ALICE_1);
  });
});

describe("signature cache", () => {
  it("a second scan with a shared cache fetches only new signatures", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    connection.addPrunedSignature(SIG_ALICE_2);
    const cache = new Map<string, ReaderTransaction | null>();

    const first = await getCollectionState(connection, GHOST_COLLECTION, {
      cache,
    });
    expect(first.minted).toBe(1);
    // The first scan fetched the mint, the pruned signature, and the
    // registered first mint (pruned in this fake) once each.
    expect(connection.fetchedSignatures).toEqual([
      SIG_ALICE_1,
      SIG_ALICE_2,
      SIG_GHOST_FIRST_MINT,
    ]);

    // A new mint lands on chain between scans.
    connection.addFixture("mint-bob-1.json");
    const second = await getCollectionState(connection, GHOST_COLLECTION, {
      cache,
    });
    expect(second.minted).toBe(2);
    expect(second.scanned).toBe(4);
    expect(second.failedFetches).toBe(0);
    // Only the new signature was fetched; the mint, the pruned
    // signature, and the registered first mint (all cached, the last
    // two as null) came from the cache.
    expect(connection.fetchedSignatures).toEqual([
      SIG_ALICE_1,
      SIG_ALICE_2,
      SIG_GHOST_FIRST_MINT,
      SIG_BOB_1,
    ]);
    expect(cache.size).toBe(4);
  });

  it("does not cache a failed fetch, so a refresh retries it", async () => {
    const connection = new FakeConnection(["mint-alice-1.json"]);
    connection.fetchErrors.set(SIG_ALICE_1, new Error("boom"));
    const cache = new Map<string, ReaderTransaction | null>();

    const first = await getCollectionState(connection, GHOST_COLLECTION, {
      cache,
    });
    expect(first.failedFetches).toBe(1);
    expect(cache.has(SIG_ALICE_1)).toBe(false);

    connection.fetchErrors.delete(SIG_ALICE_1);
    const second = await getCollectionState(connection, GHOST_COLLECTION, {
      cache,
    });
    expect(second.minted).toBe(1);
    // First scan: the mint (failed, not cached), then the registered
    // first mint (pruned, cached as null). Second scan: the mint again;
    // the registered signature came from the cache.
    expect(connection.fetchedSignatures).toEqual([
      SIG_ALICE_1,
      SIG_GHOST_FIRST_MINT,
      SIG_ALICE_1,
    ]);
  });
});

describe("malformed and unusable memos", () => {
  it("skips a malformed memo, counts it, and keeps reading", async () => {
    const connection = new FakeConnection([
      "malformed-memo.json",
      "mint-alice-1.json",
    ]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state.minted).toBe(1);
    expect(state.malformedMemos).toBe(1);
  });

  it("ignores a memo for another collection without counting it malformed", async () => {
    const connection = new FakeConnection([
      "wrong-tick-memo.json",
      "mint-alice-1.json",
    ]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state.minted).toBe(1);
    expect(state.malformedMemos).toBe(0);
    expect(state.unverifiedInscriptions).toBe(0);
  });

  it("ignores a transaction with no memo", async () => {
    const connection = new FakeConnection([
      "no-memo.json",
      "mint-alice-1.json",
    ]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state).toMatchObject({
      minted: 1,
      malformedMemos: 0,
      unverifiedInscriptions: 0,
    });
  });

  it("counts an inscription whose binding cannot be verified, and excludes it", async () => {
    const connection = new FakeConnection([
      "unverified-mint.json",
      "mint-alice-1.json",
    ]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state.minted).toBe(1);
    expect(state.unverifiedInscriptions).toBe(1);
    expect(state.holders).toBe(1);
  });

  it("ignores a failed transaction entirely", async () => {
    const connection = new FakeConnection([
      "failed-mint.json",
      "mint-alice-1.json",
    ]);
    const state = await getCollectionState(connection, GHOST_COLLECTION);
    expect(state).toMatchObject({
      minted: 1,
      malformedMemos: 0,
      unverifiedInscriptions: 0,
    });
  });
});

describe("getLeaderboard", () => {
  it("returns holders ordered by count, most first", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const board = await getLeaderboard(connection, GHOST_COLLECTION);
    expect(board).toEqual([
      { wallet: ALICE, count: 2 },
      { wallet: BOB, count: 1 },
    ]);
  });

  it("respects the limit", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const board = await getLeaderboard(connection, GHOST_COLLECTION, {
      limit: 1,
    });
    expect(board).toEqual([{ wallet: ALICE, count: 2 }]);
  });

  it("returns an empty board for an empty collection", async () => {
    const connection = new FakeConnection([]);
    const board = await getLeaderboard(connection, GHOST_COLLECTION);
    expect(board).toEqual([]);
  });
});

describe("getActivity", () => {
  it("returns mint events newest first", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const activity = await getActivity(connection, GHOST_COLLECTION);
    expect(activity).toEqual([
      {
        type: "mint",
        signature: SIG_ALICE_2,
        wallet: ALICE,
        mint: MINT_ALICE_2,
        tick: "GHOST",
        blockTime: 1795047600,
        slot: 300000120,
      },
      {
        type: "mint",
        signature: SIG_BOB_1,
        wallet: BOB,
        mint: MINT_BOB_1,
        tick: "GHOST",
        blockTime: 1795047000,
        slot: 300000050,
      },
      {
        type: "mint",
        signature: SIG_ALICE_1,
        wallet: ALICE,
        mint: MINT_ALICE_1,
        tick: "GHOST",
        blockTime: 1795046400,
        slot: 300000001,
      },
    ]);
  });

  it("respects the limit", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const activity = await getActivity(connection, GHOST_COLLECTION, {
      limit: 2,
    });
    expect(activity).toHaveLength(2);
    expect(activity[0]?.signature).toBe(SIG_ALICE_2);
    expect(activity[1]?.signature).toBe(SIG_BOB_1);
  });

  it("returns no events for an empty collection", async () => {
    const connection = new FakeConnection([]);
    const activity = await getActivity(connection, GHOST_COLLECTION);
    expect(activity).toEqual([]);
  });
});

describe("getCollectionOverview", () => {
  it("lists signatures once and derives state, leaderboard, and activity from the same scan", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const overview = await getCollectionOverview(connection, GHOST_COLLECTION);

    expect(connection.queriedAddresses).toHaveLength(1);

    const stateConnection = new FakeConnection(ALL_FIXTURES);
    const leaderboardConnection = new FakeConnection(ALL_FIXTURES);
    const activityConnection = new FakeConnection(ALL_FIXTURES);
    await expect(
      getCollectionState(stateConnection, GHOST_COLLECTION),
    ).resolves.toEqual(overview.state);
    await expect(
      getLeaderboard(leaderboardConnection, GHOST_COLLECTION),
    ).resolves.toEqual(overview.leaderboard);
    await expect(
      getActivity(activityConnection, GHOST_COLLECTION),
    ).resolves.toEqual(overview.activity);
  });

  it("respects the leaderboard and activity limits", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const overview = await getCollectionOverview(connection, GHOST_COLLECTION, {
      leaderboardLimit: 1,
      activityLimit: 1,
    });

    expect(overview.leaderboard).toHaveLength(1);
    expect(overview.activity).toHaveLength(1);
    expect(overview.state.minted).toBe(3);
  });
});

describe("lookupWallet", () => {
  it("lists a wallet's inscriptions in the collection, newest first", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const found = await lookupWallet(connection, GHOST_COLLECTION, ALICE);
    expect(found).toEqual([
      {
        mint: MINT_ALICE_2,
        tick: "GHOST",
        signature: SIG_ALICE_2,
        blockTime: 1795047600,
        slot: 300000120,
      },
      {
        mint: MINT_ALICE_1,
        tick: "GHOST",
        signature: SIG_ALICE_1,
        blockTime: 1795046400,
        slot: 300000001,
      },
    ]);
  });

  it("returns an empty list for a wallet with no inscriptions", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const found = await lookupWallet(connection, GHOST_COLLECTION, CAROL);
    expect(found).toEqual([]);
  });

  it("rejects a malformed wallet address", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    await expect(
      lookupWallet(connection, GHOST_COLLECTION, "not-an-address"),
    ).rejects.toBeInstanceOf(ReaderError);
    await expect(
      lookupWallet(connection, GHOST_COLLECTION, "not-an-address"),
    ).rejects.toMatchObject({
      reason: "invalid-wallet",
      message: expect.stringMatching(/wallet address/i),
    });
  });
});

describe("getMintLimits", () => {
  it("answers minted total, supply, and how many the wallet minted", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const limits = await getMintLimits(connection, GHOST_COLLECTION, ALICE);
    expect(limits).toEqual({
      tick: "GHOST",
      minted: 3,
      supply: 4444,
      remaining: 4441,
      mintedByWallet: 2,
      perWalletLimit: 4,
      canMint: true,
      reason: null,
    });
  });

  it("reports zero minted by a wallet with no inscriptions", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    const limits = await getMintLimits(connection, GHOST_COLLECTION, CAROL);
    expect(limits.mintedByWallet).toBe(0);
    expect(limits.canMint).toBe(true);
  });

  it("counts mints, not current holdings: a transfer after minting changes nothing", async () => {
    // Alice minted twice, then sent one inscription to Carol. The
    // reader never observes transfers (a transfer carries no memo, so
    // it never enters a scan): Alice still counts as having minted 2,
    // Carol as having minted 0, and the minted total is unchanged.
    // This is the "You minted X of 4" wording's real meaning: the
    // count is mint-time recipients, not who holds the NFT now.
    const connection = new FakeConnection([
      "transfer-alice-1-to-carol.json",
      ...ALL_FIXTURES,
    ]);
    const alice = await getMintLimits(connection, GHOST_COLLECTION, ALICE);
    expect(alice.minted).toBe(3);
    expect(alice.mintedByWallet).toBe(2);
    const carol = await getMintLimits(connection, GHOST_COLLECTION, CAROL);
    expect(carol.mintedByWallet).toBe(0);
  });

  it("refuses when the wallet reached its per-wallet limit", async () => {
    const smallLimit: CollectionConfig = loadCollectionConfig({
      ...GHOST_COLLECTION,
      perWalletLimit: 2,
    });
    const connection = new FakeConnection(ALL_FIXTURES);
    const limits = await getMintLimits(connection, smallLimit, ALICE);
    expect(limits.canMint).toBe(false);
    expect(limits.reason).toMatch(/per-wallet limit/i);
    expect(limits.mintedByWallet).toBe(2);
  });

  it("refuses when the supply is exhausted", async () => {
    const tinySupply: CollectionConfig = loadCollectionConfig({
      ...GHOST_COLLECTION,
      supply: 3,
    });
    const connection = new FakeConnection(ALL_FIXTURES);
    const limits = await getMintLimits(connection, tinySupply, CAROL);
    expect(limits.canMint).toBe(false);
    expect(limits.reason).toMatch(/supply exhausted/i);
    expect(limits.remaining).toBe(0);
  });

  it("rejects a malformed wallet address", async () => {
    const connection = new FakeConnection(ALL_FIXTURES);
    await expect(
      getMintLimits(connection, GHOST_COLLECTION, "not-an-address"),
    ).rejects.toMatchObject({ reason: "invalid-wallet" });
  });
});

/** A fake web3.js Connection, backed by recorded fixture transactions. */
class FakeParsedConnection implements ParsedTransactionConnection {
  private readonly transactions = new Map<string, ReaderTransaction>();
  private readonly order: string[] = [];
  /** Addresses getSignaturesForAddress was called with. */
  readonly queriedAddresses: PublicKey[] = [];
  /** Limits getSignaturesForAddress was called with. */
  readonly queriedLimits: Array<number | undefined> = [];
  /** Signatures getParsedTransaction was called with. */
  readonly fetchedSignatures: string[] = [];
  /** Configs getParsedTransaction was called with. */
  readonly fetchedConfigs: Array<
    { maxSupportedTransactionVersion?: number } | undefined
  > = [];

  constructor(fixtureNames: string[]) {
    for (const name of fixtureNames) {
      const { signature, transaction } = loadFixture(name);
      this.transactions.set(signature, transaction);
      this.order.push(signature);
    }
  }

  /** Add a transaction directly, as if it came from the RPC. */
  addTransaction(signature: string, transaction: ReaderTransaction): void {
    this.transactions.set(signature, transaction);
    this.order.push(signature);
  }

  async getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number },
  ): Promise<ConfirmedSignatureInfo[]> {
    this.queriedAddresses.push(address);
    this.queriedLimits.push(options?.limit);
    const limit = options?.limit ?? this.order.length;
    return this.order.slice(0, limit).map((signature) => {
      const tx = this.transactions.get(signature);
      return {
        signature,
        slot: tx?.slot ?? 0,
        err: (tx?.meta?.err as ConfirmedSignatureInfo["err"]) ?? null,
        memo: null,
        blockTime: tx?.blockTime ?? null,
      };
    });
  }

  async getParsedTransaction(
    signature: string,
    config?: { maxSupportedTransactionVersion?: number },
  ): Promise<ParsedTransactionWithMeta | null> {
    this.fetchedSignatures.push(signature);
    this.fetchedConfigs.push(config);
    const tx = this.transactions.get(signature);
    // The fixture shape is the reader's subset of a parsed transaction;
    // the adapter passes it through untouched, so the cast is safe here.
    return (tx ?? null) as unknown as ParsedTransactionWithMeta | null;
  }
}

describe("toReaderConnection", () => {
  it("adapts a Connection so the reader can scan through it", async () => {
    const parsed = new FakeParsedConnection(ALL_FIXTURES);
    const connection = toReaderConnection(parsed);

    const state = await getCollectionState(connection, GHOST_COLLECTION);

    expect(state.minted).toBe(3);
    expect(state.holders).toBe(2);
    expect(parsed.queriedAddresses).toEqual([new PublicKey(MEMO_PROGRAM_ID)]);
  });

  it("passes the scan limit through to getSignaturesForAddress", async () => {
    const parsed = new FakeParsedConnection(ALL_FIXTURES);
    const connection = toReaderConnection(parsed);

    await getCollectionState(connection, GHOST_COLLECTION, { scanLimit: 2 });

    expect(parsed.queriedLimits).toEqual([2]);
  });

  it("defaults to a scan limit that stays inside public RPC limits", async () => {
    const parsed = new FakeParsedConnection(ALL_FIXTURES);
    const connection = toReaderConnection(parsed);

    await getCollectionState(connection, GHOST_COLLECTION);

    // The public devnet RPC allows roughly 40 requests per 10 seconds
    // per method; a cold scan of 20 fetches stays comfortably inside it.
    expect(parsed.queriedLimits).toEqual([20]);
  });

  it("fetches transactions through getParsedTransaction", async () => {
    const parsed = new FakeParsedConnection(["mint-alice-1.json"]);
    const connection = toReaderConnection(parsed);

    const tx = await connection.getTransaction(SIG_ALICE_1);

    expect(parsed.fetchedSignatures).toEqual([SIG_ALICE_1]);
    expect(tx?.transaction.signatures).toEqual([SIG_ALICE_1]);
  });

  it("returns null for a transaction the RPC no longer has", async () => {
    const parsed = new FakeParsedConnection([]);
    const connection = toReaderConnection(parsed);

    await expect(connection.getTransaction(SIG_ALICE_1)).resolves.toBeNull();
  });

  it("asks the RPC for versioned transactions", async () => {
    const parsed = new FakeParsedConnection(["mint-alice-1.json"]);
    const connection = toReaderConnection(parsed);

    await connection.getTransaction(SIG_ALICE_1);

    // Without maxSupportedTransactionVersion the node rejects
    // versioned transactions with JSON-RPC error -32015, and the
    // devnet memo window regularly contains them (v0 and v1), which
    // used to surface as "records could not be read".
    expect(parsed.fetchedConfigs).toEqual([
      { maxSupportedTransactionVersion: 1 },
    ]);
  });

  it.each([0, 1])(
    "reads a version-%i transaction carrying a GHOST memo as an inscription",
    async (version) => {
      const parsed = new FakeParsedConnection([]);
      const { signature, transaction } = loadFixture("mint-alice-1.json");
      // The reader only consumes logMessages, accountKeys, and token
      // balances, which a versioned parsed transaction carries in the
      // same shape; the version field rides along untouched.
      const versioned = { ...transaction, version };
      parsed.addTransaction(signature, versioned);
      const connection = toReaderConnection(parsed);

      const state = await getCollectionState(connection, GHOST_COLLECTION);

      expect(state.minted).toBe(1);
      expect(state.holders).toBe(1);
      expect(state.failedFetches).toBe(0);
    },
  );
});
