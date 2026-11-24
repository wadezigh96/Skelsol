import { describe, expect, it } from "vitest";

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  GHOST_COLLECTION,
  getNetworkConfig,
  MEMO_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
} from "./config.js";
import { parseInscription } from "./inscription.js";
import {
  buildMintTransaction,
  MintError,
  PACKET_DATA_SIZE,
  type MintConnection,
  type MintLimits,
  type MintLimitsChecker,
} from "./mint.js";

const WALLET = new PublicKey("11111111111111111111111111111111");
/** The payment recipient for priced-mint tests (seed 5, a fixed key). */
const TREASURY = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
const BLOCKHASH = "11111111111111111111111111111111";
const NETWORK = getNetworkConfig("devnet");

/** A fake connection: no network, deterministic rent, a fixed blockhash. */
function fakeConnection(rentPerByte = 1000): MintConnection & {
  rentQueries: number[];
  blockhashQueries: number;
} {
  const rentQueries: number[] = [];
  let blockhashQueries = 0;
  return {
    rentQueries,
    get blockhashQueries() {
      return blockhashQueries;
    },
    async getMinimumBalanceForRentExemption(size: number): Promise<number> {
      rentQueries.push(size);
      // The live rent formula: (data size + 128 header bytes) x rate.
      return (size + 128) * rentPerByte;
    },
    async getLatestBlockhash(): Promise<{
      blockhash: string;
      lastValidBlockHeight: number;
    }> {
      blockhashQueries += 1;
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1 };
    },
  };
}

/** A stub limits checker: tests stand in for the reader so the mint client is tested in isolation. */
function stubLimits(overrides: Partial<MintLimits> = {}): MintLimitsChecker {
  return {
    async checkMintLimits(): Promise<MintLimits> {
      return {
        tick: "GHOST",
        minted: 0,
        supply: 4444,
        remaining: 4444,
        mintedByWallet: 0,
        perWalletLimit: 4,
        canMint: true,
        reason: null,
        ...overrides,
      };
    },
  };
}

describe("buildMintTransaction", () => {
  it("returns an unsigned transaction carrying the memo inscription and the carrier NFT mint", async () => {
    const connection = fakeConnection();
    const result = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    });

    // Three instructions: the memo inscription, then the carrier NFT mint
    // (createV1 metadata + mintV1 token, the createNft pair).
    expect(result.transaction.instructions).toHaveLength(3);
    const [memo, createV1, mintV1] = result.transaction.instructions;
    expect(memo?.programId.toBase58()).toBe(MEMO_PROGRAM_ID);
    expect(createV1?.programId.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID);
    expect(mintV1?.programId.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID);

    // The memo data is the inscription JSON, bound to the carrier NFT mint.
    const memoJson = new TextDecoder().decode(memo?.data ?? new Uint8Array());
    expect(memoJson).toBe(result.inscriptionJson);
    const parsed = parseInscription(memoJson);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.inscription).toEqual({
        p: "spl-20",
        op: "mint",
        tick: "GHOST",
        amt: "1",
        mint: result.mintKeypair.publicKey.toBase58(),
      });
    }

    // The NFT is named for its edition number (minted + 1).
    expect(
      Buffer.from(createV1?.data ?? new Uint8Array()).includes(
        Buffer.from("Spooky Ghosts #1", "utf8"),
      ),
    ).toBe(true);

    // Unsigned: the wallet pays and signs, the mint keypair signs too.
    expect(result.transaction.feePayer?.toBase58()).toBe(WALLET.toBase58());
    expect(result.transaction.recentBlockhash).toBe(BLOCKHASH);
    expect(result.transaction.signatures).toHaveLength(2);
    expect(
      result.transaction.signatures.every((s) => s.signature === null),
    ).toBe(true);

    // The returned mint keypair is the one the transaction needs: signing
    // with it alone produces a valid signature for the mint account.
    result.transaction.partialSign(result.mintKeypair);
    expect(result.transaction.verifySignatures(false)).toBe(true);

    // The serialized transaction fits the packet cap.
    expect(result.serializedSize).toBeLessThanOrEqual(1232);
    expect(result.serializedSize).toBe(
      result.transaction.serialize({ requireAllSignatures: false }).length,
    );

    // Cost comes from the live rent query: the fake charges 1,000 lamports
    // per byte, and the mint creates 1,561 bytes on-chain (1,093 for the
    // carrier NFT accounts, 468 for the token account). The total also
    // carries the estimated network fee: 5,000 lamports per signature,
    // and the mint has 2 signers (the wallet and the mint keypair).
    expect(connection.rentQueries).toEqual([0]);
    expect(result.cost).toEqual({
      carrierRentLamports: 1093000,
      tokenAccountRentLamports: 468000,
      rentLamports: 1561000,
      priceLamports: 0,
      networkFeeLamports: 10000,
      totalLamports: 1571000,
      bytesCreatedOnChain: 1561,
    });

    // A free mint has no payment leg: no SystemProgram transfer at all.
    expect(
      result.transaction.instructions.some((instruction) =>
        instruction.programId.equals(SystemProgram.programId),
      ),
    ).toBe(false);
  });

  it("pays the mint price to the configured treasury for a priced mint", async () => {
    const connection = fakeConnection();
    const result = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        priceLamports: 5000,
        treasury: TREASURY.toBase58(),
      },
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    });

    // Four instructions now: memo, carrier NFT pair, plus the payment leg.
    expect(result.transaction.instructions).toHaveLength(4);
    const payment = result.transaction.instructions.find((instruction) =>
      instruction.programId.equals(SystemProgram.programId),
    );
    expect(payment).toBeDefined();
    if (payment === undefined) {
      expect.unreachable();
    }
    // A SystemProgram transfer: from the payer, to the treasury.
    expect(payment.keys[0]?.pubkey.toBase58()).toBe(WALLET.toBase58());
    expect(payment.keys[1]?.pubkey.toBase58()).toBe(TREASURY.toBase58());
    // Transfer data: instruction index 2, then the lamports (u64, LE).
    expect(payment.data.readUInt32LE(0)).toBe(2);
    expect(payment.data.readBigUInt64LE(4)).toBe(5000n);
    expect(result.cost.priceLamports).toBe(5000);
    expect(result.cost.totalLamports).toBe(1561000 + 5000 + 10000);
  });

  it("refuses a priced mint with no treasury to pay", async () => {
    const connection = fakeConnection();
    const error = await buildMintTransaction({
      collection: { ...GHOST_COLLECTION, priceLamports: 5000 },
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("missing-treasury");
    expect((error as MintError).message).toMatch(/treasury/i);
    expect(connection.rentQueries).toEqual([]);
    expect(connection.blockhashQueries).toBe(0);
  });

  it("rounds the per-byte rent rate up, never down", async () => {
    // A header rent that is not a whole number of lamports per byte:
    // 128,129 / 128 = 1,001.007..., so the rate rounds up to 1,002.
    // Rounding down would understate the rent the minter actually pays.
    const connection: MintConnection = {
      async getMinimumBalanceForRentExemption(): Promise<number> {
        return 128129;
      },
      async getLatestBlockhash(): Promise<{
        blockhash: string;
        lastValidBlockHeight: number;
      }> {
        return { blockhash: BLOCKHASH, lastValidBlockHeight: 1 };
      },
    };
    const result = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    });
    expect(result.cost.carrierRentLamports).toBe(1002 * 1093);
    expect(result.cost.tokenAccountRentLamports).toBe(1002 * 468);
    expect(result.cost.rentLamports).toBe(1002 * 1561);
    expect(result.cost.totalLamports).toBe(1002 * 1561 + 10000);
  });

  it("refuses when the supply is exhausted, before touching the network", async () => {
    const connection = fakeConnection();
    const seen: { tick: string; wallet: PublicKey }[] = [];
    const limits: MintLimitsChecker = {
      async checkMintLimits(collection, wallet) {
        seen.push({ tick: collection.tick, wallet });
        return {
          tick: "GHOST",
          minted: 4444,
          supply: 4444,
          remaining: 0,
          mintedByWallet: 0,
          perWalletLimit: 4,
          canMint: false,
          reason: "Supply exhausted.",
        };
      },
    };

    const error = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("supply-exhausted");
    expect((error as MintError).message).toMatch(/supply exhausted/i);
    expect((error as MintError).message).toMatch(/4444 of 4444/);
    expect(seen).toEqual([{ tick: "GHOST", wallet: WALLET }]);
    expect(connection.rentQueries).toEqual([]);
    expect(connection.blockhashQueries).toBe(0);
  });

  it("refuses when the wallet has hit its per-wallet limit, before touching the network", async () => {
    const connection = fakeConnection();
    const error = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits({ minted: 10, mintedByWallet: 4 }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("per-wallet-limit-reached");
    expect((error as MintError).message).toMatch(/per-wallet limit/i);
    expect((error as MintError).message).toMatch(/4 of 4/);
    expect(connection.rentQueries).toEqual([]);
    expect(connection.blockhashQueries).toBe(0);
  });

  it("refuses a transaction over the packet cap, before querying rent", async () => {
    const connection = fakeConnection();
    const error = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
      // The real mint is ~805 bytes; a 100-byte cap forces the refusal.
      maxTransactionSizeBytes: 100,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("transaction-too-large");
    expect((error as MintError).message).toMatch(/too large/i);
    expect((error as MintError).message).toMatch(/100-byte cap/);
    expect(connection.rentQueries).toEqual([]);
  });

  it("uses the 1,232-byte packet cap by default", () => {
    expect(PACKET_DATA_SIZE).toBe(1232);
  });

  it("scales the cost with the live rent rate, and adds the mint price", async () => {
    const expensiveConnection = fakeConnection(2500);
    const expensive = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: NETWORK,
      wallet: WALLET,
      connection: expensiveConnection,
      limits: stubLimits(),
    });
    expect(expensive.cost).toEqual({
      carrierRentLamports: 2732500,
      tokenAccountRentLamports: 1170000,
      rentLamports: 3902500,
      priceLamports: 0,
      networkFeeLamports: 10000,
      totalLamports: 3912500,
      bytesCreatedOnChain: 1561,
    });

    const pricedConnection = fakeConnection();
    const priced = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        priceLamports: 5000,
        treasury: TREASURY.toBase58(),
      },
      network: NETWORK,
      wallet: WALLET,
      connection: pricedConnection,
      limits: stubLimits(),
    });
    expect(priced.cost.priceLamports).toBe(5000);
    expect(priced.cost.totalLamports).toBe(1561000 + 5000 + 10000);
  });

  it("refuses a carrier NFT name over Token Metadata's 32-byte limit", async () => {
    const connection = fakeConnection();
    const error = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        // 34 chars + " #1" = 37 bytes: over the limit.
        name: "Spooky Ghosts of the Haunted House",
      },
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("name-too-long");
    expect((error as MintError).message).toMatch(/name/i);
    expect((error as MintError).message).toMatch(/32-byte/);
    expect(connection.rentQueries).toEqual([]);
    expect(connection.blockhashQueries).toBe(0);
  });

  it("accepts a carrier NFT name of exactly 32 bytes", async () => {
    const result = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        // 28 chars + " #1" = exactly 32 bytes.
        name: "A".repeat(28),
      },
      network: NETWORK,
      wallet: WALLET,
      connection: fakeConnection(),
      limits: stubLimits(),
    });
    expect(result.transaction.instructions).toHaveLength(3);
  });

  it("refuses a metadata URI over Token Metadata's 200-byte limit", async () => {
    const connection = fakeConnection();
    const error = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        // 161-char base + 44-char mint + ".json" = 210 bytes: over the limit.
        metadataBaseUri: `https://example.com/${"a".repeat(140)}/`,
      },
      network: NETWORK,
      wallet: WALLET,
      connection,
      limits: stubLimits(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MintError);
    expect((error as MintError).reason).toBe("uri-too-long");
    expect((error as MintError).message).toMatch(/uri/i);
    expect((error as MintError).message).toMatch(/200-byte/);
    expect(connection.rentQueries).toEqual([]);
    expect(connection.blockhashQueries).toBe(0);
  });

  it("accepts a metadata URI of exactly 200 bytes", async () => {
    const result = await buildMintTransaction({
      collection: {
        ...GHOST_COLLECTION,
        // 151-char base + 44-char mint + ".json" = exactly 200 bytes.
        metadataBaseUri: `https://example.com/${"a".repeat(130)}/`,
      },
      network: NETWORK,
      wallet: WALLET,
      connection: fakeConnection(),
      limits: stubLimits(),
    });
    expect(result.transaction.instructions).toHaveLength(3);
  });
});
