import { createNft, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import {
  ACCOUNT_HEADER_SIZE,
  createNoopSigner,
  generateSigner,
  percentAmount,
  publicKey,
  signerIdentity,
  transactionBuilder,
  type Instruction,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  fromWeb3JsPublicKey,
  toWeb3JsKeypair,
  toWeb3JsLegacyTransaction,
} from "@metaplex-foundation/umi-web3js-adapters";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { buildInscription } from "./inscription.js";
import {
  MEMO_PROGRAM_ID,
  type CollectionConfig,
  type NetworkConfig,
} from "./config.js";
import type { MintLimits } from "./reader.js";

/**
 * The mint client: build the transaction that mints an inscription.
 *
 * One mint is one transaction with two parts (see ADR 0002 and the design
 * doc's "The mint flow"): a Memo instruction carrying the inscription JSON,
 * and the carrier NFT mint (Metaplex Token Metadata `createNft` semantics
 * via the Umi SDK). A priced collection adds a third part: a SystemProgram
 * transfer of the mint price from the payer to the collection's treasury.
 * The transaction is returned unsigned: the caller signs it with the
 * minter's wallet and the returned mint keypair, then sends it.
 *
 * Before building, the client checks supply and the per-wallet limit
 * through an injected {@link MintLimitsChecker} (the reader, ticket 04,
 * will be wired in by the apps) and refuses with a clear reason when the
 * mint is not allowed. Cost comes from a live rent query, never from a
 * hard-coded figure. The serialized transaction must fit the packet cap.
 */

/**
 * The maximum size of a serialized Solana transaction: one packet of
 * 1,232 bytes (Solana docs, "Transaction pipeline").
 */
export const PACKET_DATA_SIZE = 1232;

/**
 * Token Metadata limits on the carrier NFT's metadata fields, in UTF-8
 * bytes. The on-chain program rejects longer values, so the mint client
 * refuses them first with a clear reason instead of building a
 * transaction that cannot land.
 */
export const MAX_METADATA_NAME_BYTES = 32;
export const MAX_METADATA_URI_BYTES = 200;

/** What the limit check reports about a collection and a wallet. Owned by
 * the reader (it produces the numbers); the mint client uses the same
 * shape so the apps can wire the reader straight into the checker. */
export type { MintLimits } from "./reader.js";

/**
 * The limit check, injected so the mint client does not depend on the
 * reader (ticket 04, built in parallel). The apps wire the real reader in;
 * tests use a stub.
 */
export interface MintLimitsChecker {
  checkMintLimits(
    collection: CollectionConfig,
    wallet: PublicKey,
  ): Promise<MintLimits>;
}

/**
 * The smallest slice of a Solana connection the mint client needs: a live
 * rent query and a fresh blockhash. A real web3.js `Connection` satisfies
 * this; tests inject a fake, so no test touches the network.
 */
export interface MintConnection {
  getMinimumBalanceForRentExemption(size: number): Promise<number>;
  getLatestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
}

/**
 * The network fee per signature, in lamports: Solana charges 5,000
 * lamports per signature on a transaction. An estimate, not a quote:
 * the network fee is fixed per signature, so the estimate is exact for
 * a transaction that lands first try, and low when a retry is needed.
 */
export const ESTIMATED_SIGNATURE_FEE_LAMPORTS = 5_000;

/**
 * Signatures on a mint transaction: the minter's wallet and the
 * client-generated mint keypair.
 */
export const MINT_SIGNER_COUNT = 2;

/** Machine-readable reason for a mint refusal. */
export type MintErrorReason =
  | "supply-exhausted"
  | "per-wallet-limit-reached"
  | "transaction-too-large"
  | "name-too-long"
  | "uri-too-long"
  | "missing-treasury";

/** A clear, typed refusal to build a mint transaction. */
export class MintError extends Error {
  readonly reason: MintErrorReason;

  constructor(reason: MintErrorReason, message: string) {
    super(message);
    this.name = "MintError";
    this.reason = reason;
  }
}

/**
 * What a mint costs, in lamports. Rent deposits are refundable: they come
 * back when the accounts close. Every rent figure comes from a live
 * `getMinimumBalanceForRentExemption` query at build time; nothing here is
 * hard-coded (the rent rate moves under SIMD-0437, see ADR 0002).
 */
export interface MintCost {
  /** Rent-exempt deposit for the carrier NFT accounts (mint, metadata, master edition). */
  carrierRentLamports: number;
  /** Rent-exempt deposit for the minter's token account. */
  tokenAccountRentLamports: number;
  /** Total rent-exempt deposits. */
  rentLamports: number;
  /** The collection's mint price (0 = free mint, rent only). */
  priceLamports: number;
  /**
   * Estimated network fee: {@link ESTIMATED_SIGNATURE_FEE_LAMPORTS} per
   * signature times {@link MINT_SIGNER_COUNT} signatures. Shown as its
   * own line so the total is honest: rent + price alone understates
   * what the minter pays.
   */
  networkFeeLamports: number;
  /** Total lamports the minter pays: rent deposits + mint price + network fee. */
  totalLamports: number;
  /**
   * Total bytes of account storage the mint creates on-chain (including
   * the per-account headers), as reported by the Umi transaction builder.
   * The rent figures above are this byte count times the live per-byte
   * rent rate, so the on-chain charge may be slightly lower: the builder
   * sizes the metadata account conservatively.
   */
  bytesCreatedOnChain: number;
}

/** Inputs to {@link buildMintTransaction}. */
export interface BuildMintTransactionInput {
  collection: CollectionConfig;
  network: NetworkConfig;
  /**
   * The minter's wallet address: fee payer, token owner, and update
   * authority of the carrier NFT.
   */
  wallet: PublicKey;
  connection: MintConnection;
  limits: MintLimitsChecker;
  /**
   * A tighter cap on the serialized transaction size in bytes, for relays
   * that impose a lower limit than the network packet cap. Defaults to
   * {@link PACKET_DATA_SIZE}.
   */
  maxTransactionSizeBytes?: number;
}

/** What {@link buildMintTransaction} returns. */
export interface BuildMintTransactionResult {
  /**
   * The unsigned mint transaction. Sign it with the minter's wallet and
   * with {@link BuildMintTransactionResult.mintKeypair}, then send it.
   */
  transaction: Transaction;
  /**
   * The client-generated keypair for the carrier NFT mint. Its public key
   * is the inscription's `mint` field (the binding convention, ADR 0002);
   * it must sign the transaction. Keep it until the transaction confirms.
   */
  mintKeypair: Keypair;
  /** The inscription JSON written in the transaction memo. */
  inscriptionJson: string;
  /** The cost breakdown: rent deposits (live query) + mint price. */
  cost: MintCost;
  /** Serialized size of the unsigned transaction in bytes. */
  serializedSize: number;
}

/**
 * Build the mint transaction for one inscription in a collection.
 *
 * Refuses with a {@link MintError} when the supply is exhausted, the
 * wallet has hit its per-wallet limit, or the transaction would exceed
 * the packet cap. Never sends anything: returning the unsigned
 * transaction is the caller's job to sign and send.
 */
export async function buildMintTransaction(
  input: BuildMintTransactionInput,
): Promise<BuildMintTransactionResult> {
  const { collection, network, wallet, connection, limits } = input;
  const maxTransactionSizeBytes =
    input.maxTransactionSizeBytes ?? PACKET_DATA_SIZE;

  // 1. Check the limits before building anything.
  const current = await limits.checkMintLimits(collection, wallet);
  if (current.minted >= current.supply) {
    throw new MintError(
      "supply-exhausted",
      `Supply exhausted: ${current.minted} of ${current.supply} inscriptions ` +
        `in the "${collection.tick}" collection are already minted.`,
    );
  }
  if (current.mintedByWallet >= current.perWalletLimit) {
    throw new MintError(
      "per-wallet-limit-reached",
      `Per-wallet limit reached: this wallet has already minted ` +
        `${current.mintedByWallet} of ${current.perWalletLimit} allowed ` +
        `inscriptions in the "${collection.tick}" collection.`,
    );
  }

  // A priced mint needs somewhere to send the price. Configs loaded
  // through `loadCollectionConfig` already guarantee this; this check
  // catches a hand-built config that skips validation.
  if (collection.priceLamports > 0 && collection.treasury === undefined) {
    throw new MintError(
      "missing-treasury",
      `Cannot mint: the "${collection.tick}" collection charges ` +
        `${collection.priceLamports} lamports per mint but has no treasury ` +
        `address to receive the price. Set the collection's treasury first.`,
    );
  }

  // 2. The minter is an external wallet, so Umi gets a signer that carries
  // the wallet's address but cannot sign: the transaction stays unsigned
  // until the caller signs it. The Umi instance is only a transaction
  // builder here; every network read goes through the injected connection.
  const umi = createUmi(network.rpcEndpoint)
    .use(mplTokenMetadata())
    .use(signerIdentity(createNoopSigner(fromWeb3JsPublicKey(wallet)), true));

  // 3. The mint keypair is generated client-side. Its public key goes in
  // the inscription JSON's `mint` field and is the carrier NFT's mint
  // address (the binding convention, ADR 0002).
  const mint = generateSigner(umi);
  const inscriptionJson = buildInscription({
    tick: collection.tick,
    amt: "1",
    mint: mint.publicKey,
  });

  // 4. The carrier NFT's name and metadata URI. The edition number is the
  // next mint number (minted + 1); the URI is unique per mint because it
  // carries the mint address.
  const edition = current.minted + 1;
  const name = `${collection.name} #${edition}`;
  const nameBytes = new TextEncoder().encode(name).length;
  if (nameBytes > MAX_METADATA_NAME_BYTES) {
    throw new MintError(
      "name-too-long",
      `Carrier NFT name "${name}" is ${nameBytes} bytes, over Token ` +
        `Metadata's ${MAX_METADATA_NAME_BYTES}-byte limit. Shorten the collection name.`,
    );
  }
  const baseUri = collection.metadataBaseUri.endsWith("/")
    ? collection.metadataBaseUri
    : `${collection.metadataBaseUri}/`;
  const uri = `${baseUri}${mint.publicKey}.json`;
  const uriBytes = new TextEncoder().encode(uri).length;
  if (uriBytes > MAX_METADATA_URI_BYTES) {
    throw new MintError(
      "uri-too-long",
      `Carrier NFT metadata URI is ${uriBytes} bytes, over Token ` +
        `Metadata's ${MAX_METADATA_URI_BYTES}-byte limit. Shorten the metadata base URI.`,
    );
  }

  // 5. One transaction: the memo inscription first, then the carrier NFT
  // mint (createNft = createV1 metadata + master edition, then mintV1
  // minting one token to the minter). Legacy version, so every wallet
  // (including Ledger) can sign it.
  const memoInstruction: Instruction = {
    programId: publicKey(MEMO_PROGRAM_ID),
    keys: [],
    data: new TextEncoder().encode(inscriptionJson),
  };
  const nftBuilder = createNft(umi, {
    mint,
    name,
    symbol: collection.tick,
    uri,
    sellerFeeBasisPoints: percentAmount(0),
  });
  const { blockhash } = await connection.getLatestBlockhash();
  const builder = transactionBuilder()
    .add({ instruction: memoInstruction, signers: [], bytesCreatedOnChain: 0 })
    .add(nftBuilder)
    .useLegacyVersion()
    .setBlockhash(blockhash);
  const transaction = toWeb3JsLegacyTransaction(builder.build(umi));

  // 5b. The payment leg, for a priced collection: the mint price moves
  // from the payer to the collection's treasury in the same transaction
  // as the mint, so payment and minting are atomic. A free mint has no
  // payment leg. Added before the size check, so the size covers it.
  if (collection.priceLamports > 0 && collection.treasury !== undefined) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: wallet,
        toPubkey: new PublicKey(collection.treasury),
        lamports: collection.priceLamports,
      }),
    );
  }

  // 6. The transaction must fit the packet cap; refuse oversize before
  // anyone signs. Serializing with `requireAllSignatures: false` fills
  // the missing signatures with zeroes, so the size is the same as the
  // signed transaction's.
  const serializedSize = transaction.serialize({
    requireAllSignatures: false,
  }).length;
  if (serializedSize > maxTransactionSizeBytes) {
    throw new MintError(
      "transaction-too-large",
      `Transaction too large: ${serializedSize} bytes serialized, over the ` +
        `${maxTransactionSizeBytes}-byte cap. Shorten the collection name or metadata URI.`,
    );
  }

  // 7. Cost, from a live rent query. The Umi builder reports how many
  // bytes the mint creates on-chain (account data plus the per-account
  // headers); the per-byte rent rate comes from querying the rent for a
  // zero-byte account, which is exactly 128 header bytes' worth. This is
  // the same math Umi's own `getRentCreatedOnChain` uses.
  const headerRent =
    await connection.getMinimumBalanceForRentExemption(0);
  // The per-byte rate rounds UP: a truncated rate would understate the
  // rent the minter actually pays (the on-chain charge is the full
  // rent-exempt deposit, not the rounded-down estimate).
  const rentPerByte =
    (BigInt(headerRent) + BigInt(ACCOUNT_HEADER_SIZE) - 1n) /
    BigInt(ACCOUNT_HEADER_SIZE);
  const rentForBytes = (bytes: number): number =>
    Number(rentPerByte * BigInt(bytes));
  const createV1Item = nftBuilder.items[0];
  const mintV1Item = nftBuilder.items[1];
  if (createV1Item === undefined || mintV1Item === undefined) {
    throw new Error(
      "Unexpected createNft shape: expected a createV1 item and a mintV1 item.",
    );
  }
  const carrierRentLamports = rentForBytes(createV1Item.bytesCreatedOnChain);
  const tokenAccountRentLamports = rentForBytes(mintV1Item.bytesCreatedOnChain);
  const rentLamports = carrierRentLamports + tokenAccountRentLamports;
  const priceLamports = collection.priceLamports;
  const networkFeeLamports =
    ESTIMATED_SIGNATURE_FEE_LAMPORTS * MINT_SIGNER_COUNT;

  return {
    transaction,
    mintKeypair: toWeb3JsKeypair(mint),
    inscriptionJson,
    cost: {
      carrierRentLamports,
      tokenAccountRentLamports,
      rentLamports,
      priceLamports,
      networkFeeLamports,
      totalLamports: rentLamports + priceLamports + networkFeeLamports,
      bytesCreatedOnChain: builder.getBytesCreatedOnChain(),
    },
    serializedSize,
  };
}
