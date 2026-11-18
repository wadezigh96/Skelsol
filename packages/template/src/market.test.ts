import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  Connection,
  Keypair,
  PublicKey,
  type AccountInfo,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  MARKET_TREASURY,
  MarketError,
  buildBuyTransaction,
  buildCancelTransaction,
  buildListTransaction,
  checkMarketDeployed,
  decodeListing,
  deriveListingAddress,
  feeSplit,
  getFloorPrice,
  getListings,
  toMarketConnection,
  type MarketConnection,
  type MarketProgramAccountsConfig,
} from "./market.js";

/**
 * The committed IDL is the source of truth for discriminators and the
 * treasury address (ADR 0010). These tests read it straight from disk,
 * so a stale or drifted client fails here instead of on-chain.
 */
interface IdlInstruction {
  name: string;
  discriminator: number[];
}

interface IdlJson {
  instructions: IdlInstruction[];
  accounts: Array<{ name: string; discriminator: number[] }>;
  constants: Array<{ name: string; value: string }>;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const idlPath = join(
  testDir,
  "..",
  "..",
  "..",
  "programs",
  "skelsol-market",
  "idl",
  "skelsol_market.json",
);
const idl = JSON.parse(readFileSync(idlPath, "utf8")) as IdlJson;

function idlInstructionDiscriminator(name: string): number[] {
  const instruction = idl.instructions.find((entry) => entry.name === name);
  if (instruction === undefined) {
    throw new Error(`IDL has no instruction named "${name}".`);
  }
  return instruction.discriminator;
}

const LISTING_DISCRIMINATOR = (() => {
  const account = idl.accounts.find((entry) => entry.name === "Listing");
  if (account === undefined) {
    throw new Error('IDL has no account named "Listing".');
  }
  return account.discriminator;
})();

const IDL_TREASURY = (() => {
  const constant = idl.constants.find((entry) => entry.name === "TREASURY");
  if (constant === undefined) {
    throw new Error('IDL has no constant named "TREASURY".');
  }
  return constant.value;
})();

// Fixed fixture keys (seeds 1/2/3), so the derived PDA and token
// addresses below are pinned literals, computed independently in
// `.scratch/verify-market-refs.mjs` and cross-checked against
// Metaplex's ATA derivation.
const seller = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const buyer = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const mint = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;

const LISTING_ADDRESS = new PublicKey(
  "JCUvbG1XAjXE1RWDyp7gwMV5AHjz719Tbhv9gW3uD3z3",
);
const LISTING_BUMP = 255;
const SELLER_TOKEN_ACCOUNT = new PublicKey(
  "JAYwnTWS9z44Bv3N3otEHihbKfMLzTwwskqhWc9n5qii",
);
const VAULT_TOKEN_ACCOUNT = new PublicKey(
  "45yjvGJVCw7SibaJks4FbnxCU3DrceL5wVS2Hdqkzqf3",
);
const BUYER_TOKEN_ACCOUNT = new PublicKey(
  "13KoHDCDXebtaN59JpGpQCmhsk8u7qk9H9FFSCMyynLh",
);
const ESCROW_PROGRAM_ID = new PublicKey(
  "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
);

/** Compare an instruction's account metas as plain, readable values. */
function keySummary(
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
): Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> {
  return keys.map((key) => ({
    pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  }));
}

/** Build a Listing account buffer the way the program lays it out. */
function makeListingBuffer(input: {
  seller: PublicKey;
  mint: PublicKey;
  price: bigint;
  bump: number;
  discriminator?: number[];
}): Buffer {
  const data = Buffer.alloc(81);
  Buffer.from(input.discriminator ?? LISTING_DISCRIMINATOR).copy(data, 0);
  input.seller.toBuffer().copy(data, 8);
  input.mint.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(input.price, 72);
  data.writeUInt8(input.bump, 80);
  return data;
}

describe("decodeListing", () => {
  it("decodes seller, mint, price, and bump from a Listing account", () => {
    const listing = decodeListing(
      LISTING_ADDRESS,
      makeListingBuffer({
        seller,
        mint,
        price: 1_500_000_000n,
        bump: LISTING_BUMP,
      }),
    );
    expect(listing.address.equals(LISTING_ADDRESS)).toBe(true);
    expect(listing.seller.equals(seller)).toBe(true);
    expect(listing.mint.equals(mint)).toBe(true);
    expect(listing.price).toBe(1_500_000_000n);
    expect(listing.bump).toBe(LISTING_BUMP);
  });

  it("rejects a buffer with the wrong discriminator", () => {
    const data = makeListingBuffer({
      seller,
      mint,
      price: 1n,
      bump: 0,
      discriminator: [0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(() => decodeListing(LISTING_ADDRESS, data)).toThrowError(
      MarketError,
    );
    try {
      decodeListing(LISTING_ADDRESS, data);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("invalid-listing");
      expect((error as MarketError).message).toMatch(/discriminator/);
    }
  });

  it("rejects a buffer with the wrong length", () => {
    const short = makeListingBuffer({
      seller,
      mint,
      price: 1n,
      bump: 0,
    }).subarray(0, 40);
    expect(() => decodeListing(LISTING_ADDRESS, short)).toThrowError(
      MarketError,
    );
    try {
      decodeListing(LISTING_ADDRESS, short);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("invalid-listing");
      expect((error as MarketError).message).toMatch(/81 bytes/);
    }
  });
});

describe("deriveListingAddress", () => {
  it("derives the listing PDA from [\"listing\", seller, mint]", () => {
    const { address, bump } = deriveListingAddress(seller, mint, "devnet");
    expect(address.equals(LISTING_ADDRESS)).toBe(true);
    expect(bump).toBe(LISTING_BUMP);
  });
});

describe("MARKET_TREASURY", () => {
  it("equals the IDL's TREASURY constant", () => {
    expect(MARKET_TREASURY.toBase58()).toBe(IDL_TREASURY);
  });
});

describe("buildListTransaction", () => {
  it("builds one unsigned list instruction against the escrow program", () => {
    const transaction = buildListTransaction({
      network: "devnet",
      seller,
      mint,
      price: 1_500_000_000n,
    });
    expect(transaction.instructions).toHaveLength(1);
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.programId.equals(ESCROW_PROGRAM_ID)).toBe(true);
    expect(transaction.feePayer?.equals(seller)).toBe(true);
    expect(transaction.signatures).toHaveLength(0);
  });

  it("encodes the IDL list discriminator plus the price as u64 little-endian", () => {
    const transaction = buildListTransaction({
      network: "devnet",
      seller,
      mint,
      price: 1_500_000_000n,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.data.length).toBe(16);
    expect([...instruction.data.subarray(0, 8)]).toEqual(
      idlInstructionDiscriminator("list"),
    );
    expect(instruction.data.readBigUInt64LE(8)).toBe(1_500_000_000n);
  });

  it("passes the IDL's list accounts in order, with the right flags", () => {
    const transaction = buildListTransaction({
      network: "devnet",
      seller,
      mint,
      price: 1_500_000_000n,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(keySummary(instruction.keys)).toEqual([
      { pubkey: seller.toBase58(), isSigner: true, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      {
        pubkey: LISTING_ADDRESS.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SELLER_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: VAULT_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: SYSTEM_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
    ]);
  });

  it("accepts a zero price and the largest u64 price", () => {
    expect(() =>
      buildListTransaction({ network: "devnet", seller, mint, price: 0n }),
    ).not.toThrow();
    expect(() =>
      buildListTransaction({
        network: "devnet",
        seller,
        mint,
        price: (1n << 64n) - 1n,
      }),
    ).not.toThrow();
  });

  it("refuses a negative price or a price over the u64 maximum", () => {
    for (const price of [-1n, 1n << 64n]) {
      try {
        buildListTransaction({ network: "devnet", seller, mint, price });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(MarketError);
        expect((error as MarketError).reason).toBe("invalid-price");
      }
    }
  });

  it("fails loudly on a network where the program is not deployed", () => {
    expect(() =>
      buildListTransaction({ network: "mainnet", seller, mint, price: 1n }),
    ).toThrowError(/not deployed on mainnet/);
  });
});

describe("buildCancelTransaction", () => {
  it("builds one unsigned cancel instruction against the escrow program", () => {
    const transaction = buildCancelTransaction({
      network: "devnet",
      seller,
      mint,
    });
    expect(transaction.instructions).toHaveLength(1);
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.programId.equals(ESCROW_PROGRAM_ID)).toBe(true);
    expect(transaction.feePayer?.equals(seller)).toBe(true);
    expect(transaction.signatures).toHaveLength(0);
  });

  it("encodes only the IDL cancel discriminator (cancel takes no arguments)", () => {
    const transaction = buildCancelTransaction({
      network: "devnet",
      seller,
      mint,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.data.length).toBe(8);
    expect([...instruction.data]).toEqual(
      idlInstructionDiscriminator("cancel"),
    );
  });

  it("passes the IDL's cancel accounts in order, with the right flags", () => {
    const transaction = buildCancelTransaction({
      network: "devnet",
      seller,
      mint,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(keySummary(instruction.keys)).toEqual([
      { pubkey: seller.toBase58(), isSigner: true, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      {
        pubkey: LISTING_ADDRESS.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SELLER_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: VAULT_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: SYSTEM_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
    ]);
  });
});

// Type-level check (no runtime code): a real web3.js AccountInfo fits
// the market's minimal account shape, so the adapter needs no mapping.
// If the shape ever stops fitting, tsc fails here.
type AssertAssignable<Expected, Actual extends Expected> = Actual;
type _AccountInfoFitsMarket = AssertAssignable<
  { data: Buffer },
  AccountInfo<Buffer>
>;

/** A fake connection: hand-built listing buffers, no network. */
class FakeMarketConnection implements MarketConnection {
  programAccounts: Array<{ pubkey: PublicKey; account: { data: Buffer } }> =
    [];
  accountInfo = new Map<string, { data: Buffer }>();
  getProgramAccountsCalls: Array<{
    programId: PublicKey;
    config: MarketProgramAccountsConfig | undefined;
  }> = [];
  getAccountInfoCalls: PublicKey[] = [];
  programAccountsError: Error | null = null;
  accountInfoError: Error | null = null;

  getProgramAccounts(
    programId: PublicKey,
    config?: MarketProgramAccountsConfig,
  ): Promise<Array<{ pubkey: PublicKey; account: { data: Buffer } }>> {
    this.getProgramAccountsCalls.push({ programId, config });
    if (this.programAccountsError !== null) {
      return Promise.reject(this.programAccountsError);
    }
    return Promise.resolve(this.programAccounts);
  }

  getAccountInfo(
    pubkey: PublicKey,
  ): Promise<{ data: Buffer } | null> {
    this.getAccountInfoCalls.push(pubkey);
    if (this.accountInfoError !== null) {
      return Promise.reject(this.accountInfoError);
    }
    return Promise.resolve(this.accountInfo.get(pubkey.toBase58()) ?? null);
  }
}

describe("toMarketConnection", () => {
  it("adapts a Connection to the market interface, forwarding reads", async () => {
    const fake = new FakeMarketConnection();
    fake.programAccounts = [
      {
        pubkey: LISTING_ADDRESS,
        account: {
          data: makeListingBuffer({
            seller,
            mint,
            price: 1_500_000_000n,
            bump: LISTING_BUMP,
          }),
        },
      },
    ];
    const adapted = toMarketConnection(fake as unknown as Connection);
    const listings = await getListings(adapted, "devnet");
    expect(listings).toHaveLength(1);
    expect(listings[0]?.price).toBe(1_500_000_000n);
    expect(fake.getProgramAccountsCalls).toHaveLength(1);
  });
});

describe("getListings", () => {
  it("reads open listings from program accounts", async () => {
    const seller2 = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
    const mint2 = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
    const address2 = deriveListingAddress(seller2, mint2, "devnet").address;
    const connection = new FakeMarketConnection();
    connection.programAccounts = [
      {
        pubkey: LISTING_ADDRESS,
        account: {
          data: makeListingBuffer({
            seller,
            mint,
            price: 1_500_000_000n,
            bump: LISTING_BUMP,
          }),
        },
      },
      {
        pubkey: address2,
        account: {
          data: makeListingBuffer({
            seller: seller2,
            mint: mint2,
            price: 500_000_000n,
            bump: 254,
          }),
        },
      },
    ];
    const listings = await getListings(connection, "devnet");
    expect(listings).toHaveLength(2);
    expect(listings[0]?.price).toBe(1_500_000_000n);
    expect(listings[0]?.seller.equals(seller)).toBe(true);
    expect(listings[0]?.mint.equals(mint)).toBe(true);
    expect(listings[1]?.price).toBe(500_000_000n);
    expect(listings[1]?.seller.equals(seller2)).toBe(true);
    expect(listings[1]?.mint.equals(mint2)).toBe(true);
  });

  it("queries the escrow program with a Listing discriminator memcmp filter", async () => {
    const connection = new FakeMarketConnection();
    await getListings(connection, "devnet");
    expect(connection.getProgramAccountsCalls).toHaveLength(1);
    const call = connection.getProgramAccountsCalls[0];
    if (call === undefined) {
      expect.unreachable();
    }
    expect(call.programId.equals(ESCROW_PROGRAM_ID)).toBe(true);
    expect(call.config?.filters).toEqual([
      {
        memcmp: {
          offset: 0,
          encoding: "base64",
          bytes: Buffer.from(LISTING_DISCRIMINATOR).toString("base64"),
        },
      },
    ]);
  });

  it("skips a malformed program account instead of crashing", async () => {
    const connection = new FakeMarketConnection();
    connection.programAccounts = [
      {
        pubkey: LISTING_ADDRESS,
        account: {
          data: makeListingBuffer({
            seller,
            mint,
            price: 1_500_000_000n,
            bump: LISTING_BUMP,
          }),
        },
      },
      {
        pubkey: new PublicKey("11111111111111111111111111111111"),
        account: { data: Buffer.alloc(10) },
      },
    ];
    const listings = await getListings(connection, "devnet");
    expect(listings).toHaveLength(1);
    expect(listings[0]?.price).toBe(1_500_000_000n);
  });

  it("returns an empty list when no listings are open", async () => {
    const listings = await getListings(new FakeMarketConnection(), "devnet");
    expect(listings).toEqual([]);
  });

  it("reports an RPC failure as a plain-words network error", async () => {
    const connection = new FakeMarketConnection();
    connection.programAccountsError = new Error("fetch failed");
    try {
      await getListings(connection, "devnet");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("rpc-error");
      expect((error as MarketError).message).toBe(
        "Could not reach the network, try again.",
      );
    }
  });

  it("keeps the underlying RPC error as the cause", async () => {
    const connection = new FakeMarketConnection();
    const rpcError = new Error("fetch failed");
    connection.programAccountsError = rpcError;
    try {
      await getListings(connection, "devnet");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).cause).toBe(rpcError);
    }
  });
});

describe("getFloorPrice", () => {
  it("returns the lowest open price", async () => {
    const seller2 = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
    const mint2 = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
    const address2 = deriveListingAddress(seller2, mint2, "devnet").address;
    const seller3 = Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey;
    const mint3 = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
    const address3 = deriveListingAddress(seller3, mint3, "devnet").address;
    const connection = new FakeMarketConnection();
    connection.programAccounts = [
      {
        pubkey: LISTING_ADDRESS,
        account: {
          data: makeListingBuffer({
            seller,
            mint,
            price: 1_500_000_000n,
            bump: LISTING_BUMP,
          }),
        },
      },
      {
        pubkey: address2,
        account: {
          data: makeListingBuffer({
            seller: seller2,
            mint: mint2,
            price: 500_000_000n,
            bump: 254,
          }),
        },
      },
      {
        pubkey: address3,
        account: {
          data: makeListingBuffer({
            seller: seller3,
            mint: mint3,
            price: 2_000_000_000n,
            bump: 253,
          }),
        },
      },
    ];
    await expect(getFloorPrice(connection, "devnet")).resolves.toBe(
      500_000_000n,
    );
  });

  it("returns null when no listings are open", async () => {
    await expect(
      getFloorPrice(new FakeMarketConnection(), "devnet"),
    ).resolves.toBe(null);
  });
});

describe("buildBuyTransaction", () => {
  /** A fake connection where the fixture listing is open. */
  function openListingConnection(): FakeMarketConnection {
    const connection = new FakeMarketConnection();
    connection.accountInfo.set(LISTING_ADDRESS.toBase58(), {
      data: makeListingBuffer({
        seller,
        mint,
        price: 1_500_000_000n,
        bump: LISTING_BUMP,
      }),
    });
    return connection;
  }

  it("refuses before building when the listing is gone", async () => {
    const connection = new FakeMarketConnection();
    try {
      await buildBuyTransaction({
        network: "devnet",
        connection,
        buyer,
        seller,
        mint,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("listing-gone");
      expect((error as MarketError).message).toMatch(/no longer listed/);
      expect((error as MarketError).message).toContain(mint.toBase58());
    }
    // The refusal came from re-reading the listing account first.
    expect(connection.getAccountInfoCalls).toHaveLength(1);
    expect(connection.getAccountInfoCalls[0]?.equals(LISTING_ADDRESS)).toBe(
      true,
    );
  });

  it("builds one unsigned buy instruction against the escrow program", async () => {
    const transaction = await buildBuyTransaction({
      network: "devnet",
      connection: openListingConnection(),
      buyer,
      seller,
      mint,
    });
    expect(transaction.instructions).toHaveLength(1);
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.programId.equals(ESCROW_PROGRAM_ID)).toBe(true);
    expect(transaction.feePayer?.equals(buyer)).toBe(true);
    expect(transaction.signatures).toHaveLength(0);
  });

  it("encodes only the IDL buy discriminator (buy takes no arguments)", async () => {
    const transaction = await buildBuyTransaction({
      network: "devnet",
      connection: openListingConnection(),
      buyer,
      seller,
      mint,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(instruction.data.length).toBe(8);
    expect([...instruction.data]).toEqual(idlInstructionDiscriminator("buy"));
  });

  it("passes the IDL's buy accounts in order, with the right flags", async () => {
    const transaction = await buildBuyTransaction({
      network: "devnet",
      connection: openListingConnection(),
      buyer,
      seller,
      mint,
    });
    const instruction = transaction.instructions[0];
    if (instruction === undefined) {
      expect.unreachable();
    }
    expect(keySummary(instruction.keys)).toEqual([
      { pubkey: buyer.toBase58(), isSigner: true, isWritable: true },
      { pubkey: seller.toBase58(), isSigner: false, isWritable: true },
      {
        pubkey: MARKET_TREASURY.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      {
        pubkey: LISTING_ADDRESS.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: VAULT_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: BUYER_TOKEN_ACCOUNT.toBase58(),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: SYSTEM_PROGRAM_ID.toBase58(),
        isSigner: false,
        isWritable: false,
      },
    ]);
  });

  it("refuses when the stored listing is for a different seller or mint", async () => {
    const otherSeller = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
    const connection = new FakeMarketConnection();
    connection.accountInfo.set(LISTING_ADDRESS.toBase58(), {
      data: makeListingBuffer({
        seller: otherSeller,
        mint,
        price: 1_500_000_000n,
        bump: LISTING_BUMP,
      }),
    });
    try {
      await buildBuyTransaction({
        network: "devnet",
        connection,
        buyer,
        seller,
        mint,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("invalid-listing");
    }
  });

  it("reports an RPC failure as a plain-words network error", async () => {
    const connection = new FakeMarketConnection();
    connection.accountInfoError = new Error("fetch failed");
    try {
      await buildBuyTransaction({
        network: "devnet",
        connection,
        buyer,
        seller,
        mint,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("rpc-error");
      expect((error as MarketError).message).toBe(
        "Could not reach the network, try again.",
      );
    }
  });

  it("keeps the underlying RPC error as the cause", async () => {
    const connection = new FakeMarketConnection();
    const rpcError = new Error("fetch failed");
    connection.accountInfoError = rpcError;
    try {
      await buildBuyTransaction({
        network: "devnet",
        connection,
        buyer,
        seller,
        mint,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).cause).toBe(rpcError);
    }
  });

  it("refuses when the stored price differs from the expected price", async () => {
    const connection = openListingConnection();
    try {
      await buildBuyTransaction({
        network: "devnet",
        connection,
        buyer,
        seller,
        mint,
        // The preview showed 1 SOL; the listing now asks 1.5 SOL.
        expectedPriceLamports: 1_000_000_000n,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).reason).toBe("price-changed");
      expect((error as MarketError).message).toMatch(/price changed/i);
    }
  });

  it("builds when the stored price matches the expected price", async () => {
    const transaction = await buildBuyTransaction({
      network: "devnet",
      connection: openListingConnection(),
      buyer,
      seller,
      mint,
      expectedPriceLamports: 1_500_000_000n,
    });
    expect(transaction.instructions).toHaveLength(1);
  });

  it("builds without an expected price, as before", async () => {
    const transaction = await buildBuyTransaction({
      network: "devnet",
      connection: openListingConnection(),
      buyer,
      seller,
      mint,
    });
    expect(transaction.instructions).toHaveLength(1);
  });
});

describe("feeSplit", () => {
  it("splits 1% to the fee and 99% to the seller", () => {
    expect(feeSplit(1_000_000n)).toEqual({
      fee: 10_000n,
      sellerAmount: 990_000n,
    });
  });

  it("rounds the fee down and gives the remainder to the seller", () => {
    // 1,000,001 / 100 = 10,000.01: the fee is 10,000, the seller keeps 990,001.
    expect(feeSplit(1_000_001n)).toEqual({
      fee: 10_000n,
      sellerAmount: 990_001n,
    });
  });

  it("charges no fee on a price under 100 lamports", () => {
    expect(feeSplit(99n)).toEqual({ fee: 0n, sellerAmount: 99n });
    expect(feeSplit(0n)).toEqual({ fee: 0n, sellerAmount: 0n });
  });
});

describe("checkMarketDeployed", () => {
  it("reports deployed when the program account exists on devnet", async () => {
    const connection = new FakeMarketConnection();
    connection.accountInfo.set(ESCROW_PROGRAM_ID.toBase58(), {
      data: Buffer.alloc(0),
    });
    await expect(checkMarketDeployed(connection, "devnet")).resolves.toBe(
      true,
    );
  });

  it("reports not deployed when the program account is missing on devnet", async () => {
    // The current real state: the devnet program ID is final, but the
    // deploy itself is pending funding (docs/DEPLOY.md).
    await expect(
      checkMarketDeployed(new FakeMarketConnection(), "devnet"),
    ).resolves.toBe(false);
  });

  it("reports not deployed on mainnet, where no program ID is configured", async () => {
    const connection = new FakeMarketConnection();
    connection.accountInfo.set(ESCROW_PROGRAM_ID.toBase58(), {
      data: Buffer.alloc(0),
    });
    await expect(checkMarketDeployed(connection, "mainnet")).resolves.toBe(
      false,
    );
  });

  it("lets an RPC failure through instead of reporting not deployed", async () => {
    const connection = new FakeMarketConnection();
    connection.accountInfoError = new Error("RPC is down");
    await expect(checkMarketDeployed(connection, "devnet")).rejects.toThrow(
      "RPC is down",
    );
  });
});

describe("IDL cross-checks", () => {
  it("the IDL lists the three market instructions", () => {
    expect(idlInstructionDiscriminator("list")).toHaveLength(8);
    expect(idlInstructionDiscriminator("buy")).toHaveLength(8);
    expect(idlInstructionDiscriminator("cancel")).toHaveLength(8);
  });
});
