import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import {
  ConfigError,
  getEscrowProgramId,
  type Network,
} from "./config.js";
import { NETWORK_UNREACHABLE_MESSAGE } from "./errors.js";

/**
 * The market client: build list/buy/cancel transactions against the
 * escrow program, read open listings from program accounts, and compute
 * the floor price. See GLOSSARY.md: listing, escrow, floor price, fee.
 *
 * The program is built with Anchor 1.x, but there is no Anchor 1.x
 * TypeScript client on npm, so the instructions are hand-built with
 * web3.js from the committed IDL (ADR 0010):
 * `programs/skelsol-market/idl/skelsol_market.json` is the source of
 * truth for discriminators, account lists, the Listing layout, and the
 * treasury address. The tests pin every one of those against the IDL,
 * so a stale IDL fails loudly instead of silently.
 *
 * The builders return unsigned transactions: the caller sets a recent
 * blockhash, signs with the seller's (list/cancel) or buyer's (buy)
 * wallet, and sends. The SOL payment legs happen inside the program via
 * CPI; the client only supplies the accounts. The fee is 1% of the sale
 * price to the treasury; the seller receives 99%.
 *
 * The program is built and tested but not yet deployed to devnet
 * (funding pending, see docs/DEPLOY.md). These builders target the
 * final program ID; transactions to it fail until the deploy lands,
 * and the apps must say so.
 */

/** Seed for the listing PDA: `["listing", seller, mint]`. */
const LISTING_SEED = "listing";

/**
 * Instruction discriminators, copied from the IDL. Never from memory:
 * the tests assert these equal the IDL's values.
 */
const LIST_INSTRUCTION_DISCRIMINATOR = [54, 174, 193, 67, 17, 41, 132, 38];
const BUY_INSTRUCTION_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const CANCEL_INSTRUCTION_DISCRIMINATOR = [
  232, 219, 223, 41, 219, 236, 220, 190,
];

/** Account discriminator for a Listing account, from the IDL. */
const LISTING_ACCOUNT_DISCRIMINATOR = [218, 32, 50, 73, 43, 134, 26, 58];

/**
 * Size of a Listing account in bytes: 8-byte discriminator + seller (32)
 * + mint (32) + price u64 (8) + bump (1). See `state.rs`.
 */
const LISTING_ACCOUNT_SIZE = 81;

/**
 * Largest value a u64 price can hold. The one canonical u64 bound:
 * the market app imports this instead of keeping its own copy.
 */
export const MAX_U64 = (1n << 64n) - 1n;

/**
 * SPL Token program ID. Not exported by web3.js v1, so it lives here;
 * it matches the token program address in the IDL's account lists and
 * the const seed bytes of the vault's ATA derivation.
 */
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

/**
 * Associated Token program ID. Not exported by web3.js v1, so it lives
 * here; it matches the associated token program address in the IDL's
 * account lists and the program of the vault's ATA derivation.
 */
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * The fee recipient. Mirrors the IDL's TREASURY constant
 * (`programs/skelsol-market/idl/skelsol_market.json`); the test asserts
 * the two are equal. The program pays the 1% fee to this fixed address
 * on every sale and never accepts a client-supplied fee recipient, so
 * this module never takes a treasury address from caller input.
 *
 * TODO (from the IDL): placeholder treasury, the devnet deployer's
 * wallet. The owner MUST replace it with the real treasury address
 * before any mainnet deploy.
 */
export const MARKET_TREASURY = new PublicKey(
  "7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7",
);

/** Machine-readable reason for a market failure or refusal. */
export type MarketErrorReason =
  | "listing-gone"
  | "invalid-listing"
  | "invalid-price"
  | "price-changed"
  | "rpc-error";

/** A clear, typed market failure or refusal. */
export class MarketError extends Error {
  readonly reason: MarketErrorReason;

  constructor(
    reason: MarketErrorReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MarketError";
    this.reason = reason;
  }
}

/**
 * One open listing: an inscription offered for sale at a fixed price,
 * held in escrow until bought or cancelled. See GLOSSARY.md: listing.
 */
export interface Listing {
  /** The listing account's address (the listing PDA). */
  address: PublicKey;
  /** The seller who listed the NFT. Only this key may cancel. */
  seller: PublicKey;
  /** The carrier NFT's mint. */
  mint: PublicKey;
  /** Fixed sale price in lamports. `buy` always charges this price. */
  price: bigint;
  /** PDA bump for the listing account. */
  bump: number;
}

/**
 * Decode a Listing account buffer (the Borsh layout from `state.rs`:
 * 8-byte discriminator, seller, mint, price u64, bump). Rejects buffers
 * with the wrong discriminator or length with a {@link MarketError}
 * (`invalid-listing`) naming the problem.
 */
export function decodeListing(address: PublicKey, data: Buffer): Listing {
  if (data.length !== LISTING_ACCOUNT_SIZE) {
    throw new MarketError(
      "invalid-listing",
      `Invalid listing account ${address.toBase58()}: expected ` +
        `${LISTING_ACCOUNT_SIZE} bytes, got ${data.length}.`,
    );
  }
  const discriminator = [...data.subarray(0, 8)];
  // No length check here: `subarray(0, 8)` on an 81-byte buffer is
  // always 8 bytes, so the length can never differ.
  if (
    discriminator.some(
      (byte, index) => byte !== LISTING_ACCOUNT_DISCRIMINATOR[index],
    )
  ) {
    throw new MarketError(
      "invalid-listing",
      `Invalid listing account ${address.toBase58()}: wrong discriminator, ` +
        `not a Listing account.`,
    );
  }
  return {
    address,
    seller: new PublicKey(data.subarray(8, 40)),
    mint: new PublicKey(data.subarray(40, 72)),
    price: data.readBigUInt64LE(72),
    bump: data.readUInt8(80),
  };
}

/** A listing PDA and its bump. */
export interface ListingAddress {
  address: PublicKey;
  bump: number;
}

/**
 * Derive the listing PDA for a (seller, mint) pair: seeds
 * `["listing", seller, mint]` under the escrow program (see `state.rs`
 * and the IDL). One listing per (seller, mint) pair.
 */
export function deriveListingAddress(
  seller: PublicKey,
  mint: PublicKey,
  network: Network,
): ListingAddress {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(LISTING_SEED), seller.toBuffer(), mint.toBuffer()],
    new PublicKey(getEscrowProgramId(network)),
  );
  return { address, bump };
}

/**
 * Derive an associated token account: seeds `[owner, token program,
 * mint]` under the Associated Token program. The vault is the
 * associated token account whose owner is the listing PDA; the
 * seller's and buyer's token accounts are the ones owned by them.
 * This is the standard ATA derivation, and it matches the IDL's PDA
 * seeds for the vault and token accounts exactly: the IDL's const seed
 * bytes decode to the Token program ID, and its PDA program to the
 * Associated Token program ID.
 */
function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/** The program accounts every market instruction passes, in IDL order. */
function programAccounts(): Array<{
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}> {
  return [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

/** A price must fit in a u64, the program's price type. */
function validatePrice(price: bigint): void {
  if (price < 0n || price > MAX_U64) {
    throw new MarketError(
      "invalid-price",
      `Invalid price ${price.toString()} lamports: a listing price must be ` +
        `between 0 and ${MAX_U64.toString()} lamports (a u64).`,
    );
  }
}

/** Inputs to {@link buildListTransaction}. */
export interface BuildListTransactionInput {
  network: Network;
  /** The seller listing the NFT: signer, fee payer, listing payer. */
  seller: PublicKey;
  /** The carrier NFT's mint. */
  mint: PublicKey;
  /** Fixed sale price in lamports (a u64). */
  price: bigint;
}

/** Inputs to the shared seller-side builder (list and cancel). */
interface SellerMarketTransactionInput {
  network: Network;
  seller: PublicKey;
  mint: PublicKey;
  /** The instruction data: discriminator, plus the u64 price for list. */
  data: Buffer;
}

/**
 * Build the unsigned one-instruction transaction a seller signs. List
 * and cancel share the same accounts (seller, mint, listing PDA,
 * seller token account, vault, programs) and differ only in the
 * instruction data, so one helper builds both.
 */
function buildSellerMarketTransaction(
  input: SellerMarketTransactionInput,
): Transaction {
  const programId = new PublicKey(getEscrowProgramId(input.network));
  const { address: listing } = deriveListingAddress(
    input.seller,
    input.mint,
    input.network,
  );
  const sellerTokenAccount = deriveAssociatedTokenAddress(
    input.seller,
    input.mint,
  );
  const vault = deriveAssociatedTokenAddress(listing, input.mint);

  const instruction = new TransactionInstruction({
    programId,
    // Account order, signer, and writable flags follow the IDL's
    // account list exactly (confirmed against `list.rs` and
    // `cancel.rs`): list and cancel take the same accounts, in the
    // same order.
    keys: [
      { pubkey: input.seller, isSigner: true, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      ...programAccounts(),
    ],
    data: input.data,
  });

  const transaction = new Transaction();
  transaction.feePayer = input.seller;
  transaction.add(instruction);
  return transaction;
}

/**
 * Build the unsigned transaction that lists a carrier NFT for sale:
 * the NFT (exactly 1 token) moves into the PDA-owned vault, and a
 * listing account stores seller, mint, price, and bump.
 *
 * Refuses with a {@link MarketError} (`invalid-price`) when the price
 * does not fit in a u64. The caller sets a recent blockhash, signs
 * with the seller's wallet, and sends.
 */
export function buildListTransaction(
  input: BuildListTransactionInput,
): Transaction {
  validatePrice(input.price);

  // Instruction data: discriminator + u64 price, little endian.
  const data = Buffer.alloc(16);
  Buffer.from(LIST_INSTRUCTION_DISCRIMINATOR).copy(data, 0);
  data.writeBigUInt64LE(input.price, 8);

  return buildSellerMarketTransaction({
    network: input.network,
    seller: input.seller,
    mint: input.mint,
    data,
  });
}

/** Inputs to {@link buildCancelTransaction}. */
export interface BuildCancelTransactionInput {
  network: Network;
  /**
   * The seller cancelling the listing: signer and fee payer. Only the
   * listing's seller may cancel (the program enforces this).
   */
  seller: PublicKey;
  /** The carrier NFT's mint. */
  mint: PublicKey;
}

/**
 * Build the unsigned transaction that cancels a listing: the NFT
 * returns from the vault to the seller, and the listing and vault
 * accounts close (their rent returns to the seller).
 *
 * The caller sets a recent blockhash, signs with the seller's wallet,
 * and sends.
 */
export function buildCancelTransaction(
  input: BuildCancelTransactionInput,
): Transaction {
  // Instruction data: the discriminator only; cancel takes no arguments.
  return buildSellerMarketTransaction({
    network: input.network,
    seller: input.seller,
    mint: input.mint,
    data: Buffer.from(CANCEL_INSTRUCTION_DISCRIMINATOR),
  });
}

/** The 1% market fee split of a sale price. */
export interface FeeSplit {
  /** The 1% fee to the treasury: `price / 100`, rounded down. */
  fee: bigint;
  /** What the seller receives: the price minus the fee. */
  sellerAmount: bigint;
}

/**
 * Split a sale price into the 1% treasury fee and the seller's share.
 * The fee rounds down (integer division); the seller gets the
 * remainder, so any rounding leftover goes to the seller. For prices
 * under 100 lamports the fee is 0 and the seller receives the full
 * price. The program computes the same split on-chain; this is the
 * client-side mirror for previews.
 */
export function feeSplit(priceLamports: bigint): FeeSplit {
  const fee = priceLamports / 100n;
  return { fee, sellerAmount: priceLamports - fee };
}

/** Inputs to {@link buildBuyTransaction}. */
export interface BuildBuyTransactionInput {
  network: Network;
  connection: MarketConnection;
  /** The buyer paying the listing price: signer and fee payer. */
  buyer: PublicKey;
  /** The seller of the listing being bought. */
  seller: PublicKey;
  /** The carrier NFT's mint. */
  mint: PublicKey;
  /**
   * The price the buyer previewed (from the listing as last read).
   * When provided, the buy refuses with a `MarketError`
   * (`price-changed`) if the price stored on-chain differs: the buyer
   * must never pay a price they did not preview. Optional, so callers
   * that have no preview (a direct buy) keep working.
   */
  expectedPriceLamports?: bigint;
}

/**
 * Build the unsigned transaction that buys a listed carrier NFT: the
 * buyer pays the listing price in SOL (99% to the seller, 1% to the
 * treasury), the NFT moves from the vault to the buyer, and the
 * listing and vault accounts close.
 *
 * Before building, the listing account is re-read from the chain: the
 * buy refuses with a {@link MarketError} (`listing-gone`) when the
 * listing is no longer there (bought or cancelled since it was last
 * read), instead of building a transaction that cannot land. When the
 * caller passes `expectedPriceLamports`, the buy also refuses with a
 * {@link MarketError} (`price-changed`) when the stored price differs
 * from the previewed price. The price is never taken from caller
 * input: the program charges the price stored in the listing account.
 *
 * The caller sets a recent blockhash, signs with the buyer's wallet,
 * and sends.
 */
export async function buildBuyTransaction(
  input: BuildBuyTransactionInput,
): Promise<Transaction> {
  const programId = new PublicKey(getEscrowProgramId(input.network));
  const { address: listing } = deriveListingAddress(
    input.seller,
    input.mint,
    input.network,
  );

  // Re-read the listing first: refuse when it is gone.
  let info: { data: Buffer } | null;
  try {
    info = await input.connection.getAccountInfo(listing);
  } catch (error) {
    throw new MarketError("rpc-error", NETWORK_UNREACHABLE_MESSAGE, {
      cause: error,
    });
  }
  if (info === null) {
    throw new MarketError(
      "listing-gone",
      `Listing gone: the inscription ${input.mint.toBase58()} from seller ` +
        `${input.seller.toBase58()} is no longer listed (it was bought or ` +
        `cancelled). Check the current listings and try again.`,
    );
  }
  const stored = decodeListing(listing, info.data);
  if (!stored.seller.equals(input.seller) || !stored.mint.equals(input.mint)) {
    throw new MarketError(
      "invalid-listing",
      `Invalid listing account ${listing.toBase58()}: it does not match ` +
        `seller ${input.seller.toBase58()} and mint ${input.mint.toBase58()}.`,
    );
  }
  if (
    input.expectedPriceLamports !== undefined &&
    stored.price !== input.expectedPriceLamports
  ) {
    throw new MarketError(
      "price-changed",
      `Price changed: the listing was ${input.expectedPriceLamports.toString()} ` +
        `lamports when you previewed it, but it is now ` +
        `${stored.price.toString()} lamports. Check the current listings ` +
        `and try again.`,
    );
  }

  const vault = deriveAssociatedTokenAddress(listing, input.mint);
  const buyerTokenAccount = deriveAssociatedTokenAddress(
    input.buyer,
    input.mint,
  );

  // Instruction data: the discriminator only; buy takes no arguments.
  const data = Buffer.from(BUY_INSTRUCTION_DISCRIMINATOR);

  const instruction = new TransactionInstruction({
    programId,
    // Account order, signer, and writable flags follow the IDL's buy
    // account list exactly (confirmed against `buy.rs`). The treasury
    // is the module's fixed MARKET_TREASURY, never caller input.
    keys: [
      { pubkey: input.buyer, isSigner: true, isWritable: true },
      { pubkey: input.seller, isSigner: false, isWritable: true },
      { pubkey: MARKET_TREASURY, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: listing, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      ...programAccounts(),
    ],
    data,
  });

  const transaction = new Transaction();
  transaction.feePayer = input.buyer;
  transaction.add(instruction);
  return transaction;
}

/**
 * One program account, the smallest shape the market reads: its address
 * and its raw data. A real web3.js `AccountInfo` fits this shape.
 */
export interface MarketProgramAccount {
  pubkey: PublicKey;
  account: { data: Buffer };
}

/**
 * The `getProgramAccounts` filter the market uses: a memcmp filter on
 * the Listing discriminator (base64-encoded, so no base58 dependency).
 * The two memcmp branches mirror web3.js's own `MemcmpFilter` shape,
 * so a real `Connection`'s config type accepts this filter.
 */
export type MarketProgramAccountsFilter =
  | {
      memcmp: {
        offset: number;
        bytes: string;
        encoding?: "base58";
      };
    }
  | {
      memcmp: {
        offset: number;
        bytes: string;
        encoding: "base64";
      };
    }
  | { dataSize: number };

/**
 * The `getProgramAccounts` config the market uses: a memcmp filter on
 * the Listing discriminator. A real web3.js `GetProgramAccountsConfig`
 * accepts this shape.
 */
export interface MarketProgramAccountsConfig {
  filters?: MarketProgramAccountsFilter[];
}

/**
 * The smallest slice of a web3.js `Connection` the market needs: list
 * the escrow program's accounts (filtered to Listing accounts) and
 * fetch one account by address. The apps adapt their `Connection`
 * with {@link toMarketConnection}; tests inject a fake, so no test
 * touches the network.
 */
export interface MarketConnection {
  getProgramAccounts(
    programId: PublicKey,
    config?: MarketProgramAccountsConfig,
  ): Promise<readonly MarketProgramAccount[]>;
  getAccountInfo(pubkey: PublicKey): Promise<{ data: Buffer } | null>;
}

/**
 * Adapt a web3.js `Connection` to the {@link MarketConnection} the
 * market functions take. A real `Connection` is not directly
 * assignable to the interface: its `getProgramAccounts` has a
 * `withContext` overload whose return shape differs, so the adapter
 * pins the plain overload (the same reason the reader has
 * `toReaderConnection`).
 */
export function toMarketConnection(connection: Connection): MarketConnection {
  return {
    getProgramAccounts: (programId, config) =>
      connection.getProgramAccounts(programId, config),
    getAccountInfo: (pubkey) => connection.getAccountInfo(pubkey),
  };
}

/**
 * Read the open listings from the escrow program's accounts: every
 * Listing account on the network, decoded to seller, mint, price, and
 * bump. The RPC query filters on the Listing discriminator, so only
 * Listing accounts come back. A malformed account is skipped, never a
 * crash (the reader treats malformed memos the same way). An RPC
 * failure rejects with a {@link MarketError} (`rpc-error`).
 */
export async function getListings(
  connection: MarketConnection,
  network: Network,
): Promise<Listing[]> {
  const programId = new PublicKey(getEscrowProgramId(network));
  let accounts: readonly MarketProgramAccount[];
  try {
    accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 0,
            encoding: "base64",
            bytes: Buffer.from(LISTING_ACCOUNT_DISCRIMINATOR).toString(
              "base64",
            ),
          },
        },
      ],
    });
  } catch (error) {
    throw new MarketError("rpc-error", NETWORK_UNREACHABLE_MESSAGE, {
      cause: error,
    });
  }

  const listings: Listing[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      listings.push(decodeListing(pubkey, account.data));
    } catch (error) {
      // A malformed program account is skipped, not fatal.
      if (error instanceof MarketError && error.reason === "invalid-listing") {
        continue;
      }
      throw error;
    }
  }
  return listings;
}

/**
 * True when the market (escrow) program is deployed on a network.
 *
 * This is the check that keeps "the program is not deployed yet"
 * separate from "the program is deployed but has no listings":
 * `getProgramAccounts` returns an empty list either way, so the caller
 * reads the program account itself. A missing program account means
 * not deployed; a network with no program ID configured at all
 * (mainnet, for now) is not deployed either.
 *
 * An RPC failure is not "not deployed": it propagates, so the caller
 * can say the network could not be reached instead of misreporting the
 * program as missing.
 */
export async function checkMarketDeployed(
  connection: MarketConnection,
  network: Network,
): Promise<boolean> {
  let programId: string;
  try {
    programId = getEscrowProgramId(network);
  } catch (error) {
    if (error instanceof ConfigError) {
      return false;
    }
    throw error;
  }
  const info = await connection.getAccountInfo(new PublicKey(programId));
  return info !== null;
}

/**
 * The floor price: the lowest price among currently open listings, or
 * null when no listings are open. See GLOSSARY.md: floor price.
 */
export async function getFloorPrice(
  connection: MarketConnection,
  network: Network,
): Promise<bigint | null> {
  const listings = await getListings(connection, network);
  let floor: bigint | null = null;
  for (const listing of listings) {
    if (floor === null || listing.price < floor) {
      floor = listing.price;
    }
  }
  return floor;
}
