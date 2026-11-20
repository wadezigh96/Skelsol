import {
  buildBuyTransaction,
  buildCancelTransaction,
  buildListTransaction,
  buildMintTransaction,
  createReaderLimitsChecker,
  decodeListing,
  deriveListingAddress,
  explorerTransactionUrl,
  feeSplit,
  formatLamports,
  formatLamportsBigint,
  getCollectionState,
  getFloorPrice,
  getNetworkConfig,
  GHOST_COLLECTION,
  lookupWallet,
  MarketError,
  toMarketConnection,
  toReaderConnection,
  type Listing,
  type Network,
} from "@skelsol/template";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import { CliError, type ParsedArgs } from "./args.js";
import {
  assertMarketProgramDeployed,
  isMarketProgramDeployed,
  marketNotDeployedMessage,
} from "./program.js";

/**
 * The `skel` commands, built on the template library. Every command
 * runs through `runCommand`, which takes its I/O as dependencies so
 * the tests run offline against a fake connection.
 *
 * Output streams (ADR 0007, and the `--json` contract): previews and
 * confirmation prompts go to stderr; stdout carries only the final
 * result (human-readable text by default, one JSON object with
 * `--json`, nothing else).
 *
 * Safety rule: every write prints a preview to stderr and sends only
 * after `deps.confirm` returns true for that exact action. The CLI
 * never sends without asking, and there is no `--yes` flag.
 */

/** The I/O a command run needs, injected so tests can fake it. */
export interface RunDeps {
  /** A real web3.js Connection in the CLI; a fake in tests. */
  connection: Connection;
  /** Ask the user to confirm one exact action; true means send it. */
  confirm: (prompt: string) => Promise<boolean>;
  /** One line of final output (stdout in the CLI). */
  stdout: (line: string) => void;
  /** One line of preview, prompt, or abort text (stderr in the CLI). */
  stderr: (line: string) => void;
  /** Load a keypair file; throws a KeypairError when it cannot. */
  readKeypair: (path: string) => Keypair;
}

/** A JSON result object: bigints are already stringified by callers. */
type JsonResult = Record<string, unknown>;

/** Emit the final result: one JSON object with --json, text otherwise. */
function emitResult(
  parsed: ParsedArgs,
  deps: RunDeps,
  humanLines: string[],
  json: JsonResult,
): void {
  if (parsed.json) {
    deps.stdout(JSON.stringify(json));
    return;
  }
  for (const line of humanLines) {
    deps.stdout(line);
  }
}

/** The keypair a write needs, or a clear refusal when none was given. */
function requireKeypair(parsed: ParsedArgs, deps: RunDeps): Keypair {
  if (parsed.keypairPath === null) {
    throw new CliError(
      "This command needs a wallet: pass --keypair <path> with a local " +
        "keypair file. Never commit a keypair, and never use one holding " +
        "large funds; use a dedicated low-value agent wallet.",
    );
  }
  return deps.readKeypair(parsed.keypairPath);
}

/** Parse an address argument, or refuse with a clear error. */
function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new CliError(
      `Invalid ${label} "${value}": it must be a valid Solana address.`,
    );
  }
}

/**
 * Show a preview on stderr, ask for confirmation, and report whether
 * the user confirmed. On a no, an abort line goes to stderr and the
 * caller returns exit code 1 without sending anything.
 */
async function previewAndConfirm(
  deps: RunDeps,
  previewLines: string[],
  prompt: string,
): Promise<boolean> {
  for (const line of previewLines) {
    deps.stderr(line);
  }
  const confirmed = await deps.confirm(prompt);
  if (!confirmed) {
    deps.stderr("Aborted: the transaction was not sent.");
  }
  return confirmed;
}

/** Sign with every signer, send, and wait for confirmation. */
async function signAndSend(
  connection: Connection,
  transaction: Transaction,
  signers: Keypair[],
): Promise<string> {
  transaction.partialSign(...signers);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
  );
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

/** The market builders leave the blockhash unset; set a fresh one. */
async function setFreshBlockhash(
  connection: Connection,
  transaction: Transaction,
): Promise<void> {
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
}

/**
 * Read one listing account for a preview. Throws a `MarketError`
 * (`listing-gone`) when the account is missing, so a buy or cancel
 * refuses before building a transaction that cannot land.
 */
async function readListingForPreview(
  connection: Connection,
  listingAddress: PublicKey,
  seller: PublicKey,
  mint: PublicKey,
): Promise<Listing> {
  const info = await connection.getAccountInfo(listingAddress);
  if (info === null) {
    throw new MarketError(
      "listing-gone",
      `Listing gone: the inscription ${mint.toBase58()} from seller ` +
        `${seller.toBase58()} is no longer listed (it was bought or ` +
        `cancelled). Check the current listings and try again.`,
    );
  }
  return decodeListing(listingAddress, info.data);
}

async function runStatus(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const connection = deps.connection;
  const state = await getCollectionState(
    toReaderConnection(connection),
    GHOST_COLLECTION,
  );
  const marketConnection = toMarketConnection(connection);
  const deployed = await isMarketProgramDeployed(
    marketConnection,
    parsed.network,
  );
  const floor: bigint | null = deployed
    ? await getFloorPrice(marketConnection, parsed.network)
    : null;
  const floorText = !deployed
    ? `unavailable: ${marketNotDeployedMessage(parsed.network)}`
    : floor === null
      ? "no open listings"
      : formatLamportsBigint(floor);
  const humanLines = [
    `${GHOST_COLLECTION.tick} (${GHOST_COLLECTION.name}) on ${parsed.network}`,
    `Minted: ${state.minted} of ${state.supply} (${state.remaining} remaining)`,
    `Minters: ${state.holders}`,
    `Floor price: ${floorText}`,
  ];
  if (state.malformedMemos > 0) {
    humanLines.push(`Malformed memos skipped: ${state.malformedMemos}`);
  }
  if (state.unverifiedInscriptions > 0) {
    humanLines.push(
      `Unverified inscriptions excluded: ${state.unverifiedInscriptions}`,
    );
  }
  if ((state.fromRegistry ?? 0) > 0) {
    humanLines.push(
      `Verified from the collection registry: ${state.fromRegistry}`,
    );
  }
  if ((state.failedFetches ?? 0) > 0) {
    humanLines.push(
      `Warning: ${state.failedFetches} of ${state.scanned} records could ` +
        `not be read (rate-limited). Numbers above may be incomplete — ` +
        `run again to retry.`,
    );
  }
  emitResult(parsed, deps, humanLines, {
    command: "status",
    network: parsed.network,
    tick: state.tick,
    name: GHOST_COLLECTION.name,
    supply: state.supply,
    minted: state.minted,
    remaining: state.remaining,
    // The field name stays `holders` for machine consumers, but the
    // count is really minters: the reader never observes transfers, so
    // it counts the wallets that minted, not the wallets that hold now.
    holders: state.holders,
    malformedMemos: state.malformedMemos,
    unverifiedInscriptions: state.unverifiedInscriptions,
    scanned: state.scanned ?? 0,
    failedFetches: state.failedFetches ?? 0,
    fromRegistry: state.fromRegistry ?? 0,
    floorPriceLamports: floor === null ? null : floor.toString(),
    floorPrice: floor === null ? null : formatLamportsBigint(floor),
    marketStatus: deployed ? "live" : "not-deployed",
    marketMessage: deployed ? null : marketNotDeployedMessage(parsed.network),
  });
  return 0;
}

async function runLookup(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const wallet = parsed.args[0] as string;
  const inscriptions = await lookupWallet(
    toReaderConnection(deps.connection),
    GHOST_COLLECTION,
    wallet,
  );
  const count = inscriptions.length;
  const humanLines = [
    `Wallet ${wallet}: ${count} GHOST inscription${count === 1 ? "" : "s"}`,
  ];
  for (const inscription of inscriptions) {
    humanLines.push(
      `  ${inscription.mint} · ${explorerTransactionUrl(inscription.signature, parsed.network)}`,
    );
  }
  emitResult(parsed, deps, humanLines, {
    command: "lookup",
    network: parsed.network,
    wallet,
    tick: GHOST_COLLECTION.tick,
    count,
    inscriptions: inscriptions.map((inscription) => ({
      mint: inscription.mint,
      signature: inscription.signature,
      blockTime: inscription.blockTime,
      slot: inscription.slot,
      explorerUrl: explorerTransactionUrl(
        inscription.signature,
        parsed.network,
      ),
    })),
  });
  return 0;
}

async function runMint(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const keypair = requireKeypair(parsed, deps);
  const connection = deps.connection;
  const result = await buildMintTransaction({
    collection: GHOST_COLLECTION,
    network: getNetworkConfig(parsed.network),
    wallet: keypair.publicKey,
    connection,
    limits: createReaderLimitsChecker(toReaderConnection(connection)),
  });
  const mintAddress = result.mintKeypair.publicKey.toBase58();
  const confirmed = await previewAndConfirm(
    deps,
    [
      "Preview: mint one GHOST inscription + carrier NFT.",
      `  Wallet: ${keypair.publicKey.toBase58()}`,
      `  Inscription: ${result.inscriptionJson}`,
      `  Carrier NFT mint: ${mintAddress}`,
      `  Rent deposits: ${formatLamports(result.cost.rentLamports)} (${result.cost.rentLamports} lamports)`,
      `  Mint price: ${formatLamports(result.cost.priceLamports)} (${result.cost.priceLamports} lamports)`,
      `  Network fee (estimate): ${formatLamports(result.cost.networkFeeLamports)} (${result.cost.networkFeeLamports} lamports)`,
      `  Total: ${formatLamports(result.cost.totalLamports)} (${result.cost.totalLamports} lamports)`,
      "  Rent deposits are refundable: they come back when the accounts close.",
      "  Nothing is sent until you confirm.",
    ],
    "Send this mint transaction? Type yes to confirm: ",
  );
  if (!confirmed) {
    return 1;
  }
  const signature = await signAndSend(connection, result.transaction, [
    keypair,
    result.mintKeypair,
  ]);
  const explorerUrl = explorerTransactionUrl(signature, parsed.network);
  emitResult(
    parsed,
    deps,
    [
      "Minted! Your ghost inscription is on-chain.",
      `Carrier NFT mint: ${mintAddress}`,
      `Signature: ${signature}`,
      `Explorer: ${explorerUrl}`,
    ],
    {
      command: "mint",
      network: parsed.network,
      signature,
      mint: mintAddress,
      inscriptionJson: result.inscriptionJson,
      cost: {
        carrierRentLamports: result.cost.carrierRentLamports,
        tokenAccountRentLamports: result.cost.tokenAccountRentLamports,
        rentLamports: result.cost.rentLamports,
        priceLamports: result.cost.priceLamports,
        networkFeeLamports: result.cost.networkFeeLamports,
        totalLamports: result.cost.totalLamports,
        total: formatLamports(result.cost.totalLamports),
      },
      explorerUrl,
    },
  );
  return 0;
}

async function runList(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const keypair = requireKeypair(parsed, deps);
  const connection = deps.connection;
  const network: Network = parsed.network;
  const mint = parsePublicKey(parsed.args[0] as string, "mint address");
  const price = parsed.priceLamports as bigint;
  await assertMarketProgramDeployed(toMarketConnection(connection), network);
  const { address: listing } = deriveListingAddress(
    keypair.publicKey,
    mint,
    network,
  );
  const transaction = buildListTransaction({
    network,
    seller: keypair.publicKey,
    mint,
    price,
  });
  await setFreshBlockhash(connection, transaction);
  const confirmed = await previewAndConfirm(
    deps,
    [
      "Preview: list one carrier NFT for sale.",
      `  Seller: ${keypair.publicKey.toBase58()}`,
      `  Carrier NFT mint: ${mint.toBase58()}`,
      `  Listing: ${listing.toBase58()}`,
      `  Price: ${formatLamportsBigint(price)} (${price.toString()} lamports)`,
      "  Fee on sale: 1% to the treasury; you receive 99%.",
      "  The NFT moves into escrow until it is bought or the listing is cancelled.",
      "  Nothing is sent until you confirm.",
    ],
    "Send this list transaction? Type yes to confirm: ",
  );
  if (!confirmed) {
    return 1;
  }
  const signature = await signAndSend(connection, transaction, [keypair]);
  const explorerUrl = explorerTransactionUrl(signature, network);
  emitResult(
    parsed,
    deps,
    [
      "Listed! Your carrier NFT is in escrow.",
      `Listing: ${listing.toBase58()}`,
      `Signature: ${signature}`,
      `Explorer: ${explorerUrl}`,
    ],
    {
      command: "list",
      network,
      signature,
      listing: listing.toBase58(),
      seller: keypair.publicKey.toBase58(),
      mint: mint.toBase58(),
      priceLamports: price.toString(),
      price: formatLamportsBigint(price),
      explorerUrl,
    },
  );
  return 0;
}

async function runBuy(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const keypair = requireKeypair(parsed, deps);
  const connection = deps.connection;
  const network: Network = parsed.network;
  const seller = parsePublicKey(parsed.args[0] as string, "seller address");
  const mint = parsePublicKey(parsed.args[1] as string, "mint address");
  await assertMarketProgramDeployed(toMarketConnection(connection), network);
  const { address: listing } = deriveListingAddress(seller, mint, network);
  // Read the listing for the preview price. The transaction is NOT built
  // yet: the listing can change while the user reads the preview, so the
  // build (and its price check) happens after confirmation, against the
  // price shown here. The program charges the stored price, never client
  // input, so the preview price is the price that will be paid.
  const stored = await readListingForPreview(connection, listing, seller, mint);
  const price = stored.price;
  const { fee, sellerAmount: sellerReceives } = feeSplit(price);
  const confirmed = await previewAndConfirm(
    deps,
    [
      "Preview: buy one listed inscription.",
      `  Buyer: ${keypair.publicKey.toBase58()}`,
      `  Seller: ${seller.toBase58()}`,
      `  Carrier NFT mint: ${mint.toBase58()}`,
      `  Listing: ${listing.toBase58()}`,
      `  Price: ${formatLamportsBigint(price)} (${price.toString()} lamports)`,
      `  Seller receives: ${formatLamportsBigint(sellerReceives)} (${sellerReceives.toString()} lamports)`,
      `  Treasury fee (1%): ${formatLamportsBigint(fee)} (${fee.toString()} lamports)`,
      "  Nothing is sent until you confirm.",
    ],
    "Send this buy transaction? Type yes to confirm: ",
  );
  if (!confirmed) {
    return 1;
  }
  // Re-read and rebuild after confirmation: the builder refuses when the
  // listing is gone or the price moved since the preview, so the buyer
  // never pays for something that is not there, or at a changed price.
  // Building here also keeps the blockhash fresh (it is set below).
  const transaction = await buildBuyTransaction({
    network,
    connection: toMarketConnection(connection),
    buyer: keypair.publicKey,
    seller,
    mint,
    expectedPriceLamports: price,
  });
  await setFreshBlockhash(connection, transaction);
  const signature = await signAndSend(connection, transaction, [keypair]);
  const explorerUrl = explorerTransactionUrl(signature, network);
  emitResult(
    parsed,
    deps,
    [
      "Bought! The carrier NFT is in your wallet.",
      `Listing: ${listing.toBase58()}`,
      `Signature: ${signature}`,
      `Explorer: ${explorerUrl}`,
    ],
    {
      command: "buy",
      network,
      signature,
      listing: listing.toBase58(),
      buyer: keypair.publicKey.toBase58(),
      seller: seller.toBase58(),
      mint: mint.toBase58(),
      priceLamports: price.toString(),
      price: formatLamportsBigint(price),
      feeLamports: fee.toString(),
      fee: formatLamportsBigint(fee),
      sellerReceivesLamports: sellerReceives.toString(),
      sellerReceives: formatLamportsBigint(sellerReceives),
      explorerUrl,
    },
  );
  return 0;
}

async function runCancel(parsed: ParsedArgs, deps: RunDeps): Promise<number> {
  const keypair = requireKeypair(parsed, deps);
  const connection = deps.connection;
  const network: Network = parsed.network;
  const mint = parsePublicKey(parsed.args[0] as string, "mint address");
  await assertMarketProgramDeployed(toMarketConnection(connection), network);
  const { address: listing } = deriveListingAddress(
    keypair.publicKey,
    mint,
    network,
  );
  // Same read as buy: one helper, one error type, one message for a
  // missing listing (MarketError "listing-gone").
  const stored = await readListingForPreview(
    connection,
    listing,
    keypair.publicKey,
    mint,
  );
  const transaction = buildCancelTransaction({
    network,
    seller: keypair.publicKey,
    mint,
  });
  await setFreshBlockhash(connection, transaction);
  const confirmed = await previewAndConfirm(
    deps,
    [
      "Preview: cancel your listing.",
      `  Seller: ${keypair.publicKey.toBase58()}`,
      `  Carrier NFT mint: ${mint.toBase58()}`,
      `  Listing: ${listing.toBase58()}`,
      `  Listed price: ${formatLamportsBigint(stored.price)} (${stored.price.toString()} lamports)`,
      "  The NFT returns to your wallet and the listing closes.",
      "  Nothing is sent until you confirm.",
    ],
    "Send this cancel transaction? Type yes to confirm: ",
  );
  if (!confirmed) {
    return 1;
  }
  const signature = await signAndSend(connection, transaction, [keypair]);
  const explorerUrl = explorerTransactionUrl(signature, network);
  emitResult(
    parsed,
    deps,
    [
      "Cancelled! The carrier NFT is back in your wallet.",
      `Listing: ${listing.toBase58()}`,
      `Signature: ${signature}`,
      `Explorer: ${explorerUrl}`,
    ],
    {
      command: "cancel",
      network,
      signature,
      listing: listing.toBase58(),
      seller: keypair.publicKey.toBase58(),
      mint: mint.toBase58(),
      priceLamports: stored.price.toString(),
      price: formatLamportsBigint(stored.price),
      explorerUrl,
    },
  );
  return 0;
}

/**
 * Run one parsed command. Returns the process exit code: 0 on success,
 * 1 when the user declines to confirm. Failures reject with an error
 * whose message is safe to print (no stack trace); the entry point
 * prints `Error: <message>` and exits 1.
 */
export async function runCommand(
  parsed: ParsedArgs,
  deps: RunDeps,
): Promise<number> {
  switch (parsed.command) {
    case "status":
      return runStatus(parsed, deps);
    case "lookup":
      return runLookup(parsed, deps);
    case "mint":
      return runMint(parsed, deps);
    case "list":
      return runList(parsed, deps);
    case "buy":
      return runBuy(parsed, deps);
    case "cancel":
      return runCancel(parsed, deps);
  }
}
