import {
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";

import {
  MEMO_PROGRAM_ID,
  type CollectionConfig,
} from "./config.js";
import { NETWORK_UNREACHABLE_MESSAGE } from "./errors.js";
import {
  parseInscription,
  verifyInscription,
  type Inscription,
} from "./inscription.js";

/**
 * The template reader: rebuilds collection state from on-chain records.
 *
 * The reader scans recent transactions that touched the Memo program
 * (`getSignaturesForAddress`), fetches each one (`getTransaction`,
 * `jsonParsed`), extracts the memo from `meta.logMessages`, parses it as
 * inscription JSON, and verifies the binding convention from ADR 0002:
 * the memo's `mint` field must name a mint created in that same
 * transaction (present in `postTokenBalances`, absent from
 * `preTokenBalances`). Verified inscriptions aggregate into minted count,
 * holders, leaderboard, activity, and wallet lookup.
 *
 * A malformed memo is skipped and counted, never a crash. A failed
 * transaction is ignored entirely: its memo never became an inscription.
 * A fetch that fails (the public RPC rate-limits bursts of fetches) is
 * retried with backoff when it looks like rate limiting, then skipped
 * and counted, never fatal: only a failed signature listing fails the
 * whole scan. Callers can pass a signature cache so a refresh fetches
 * only new transactions. The reader never trusts client input: every
 * count comes from the chain (or, in tests, from recorded fixture
 * transactions).
 *
 * This module is offline-testable: it reads through the minimal
 * {@link ReaderConnection} interface, and tests back it with recorded
 * transaction fixtures (see `fixtures/`). No test touches the live
 * network.
 */

/** Machine-readable reason for a reader rejection. */
export type ReaderErrorReason = "invalid-wallet" | "rpc-error";

/** A clear, typed reader failure. */
export class ReaderError extends Error {
  readonly reason: ReaderErrorReason;

  constructor(
    reason: ReaderErrorReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ReaderError";
    this.reason = reason;
  }
}

/**
 * The smallest transaction shape the reader needs: the fields of a
 * `jsonParsed` transaction it actually reads. A real
 * `ParsedTransactionWithMeta` fits this shape, so a real `Connection`
 * adapts with a one-line wrapper:
 *
 *   const readerConnection = {
 *     getSignaturesForAddress: (address, options) =>
 *       connection.getSignaturesForAddress(address, options),
 *     getTransaction: (signature) =>
 *       connection.getParsedTransaction(signature),
 *   };
 *
 * (The wrapper uses `getParsedTransaction`, not `getTransaction`: in
 * web3.js v1 the parsed shape is what carries `logMessages` and token
 * balances in this form.)
 */
export interface ReaderTokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

export interface ReaderAccountKey {
  pubkey: PublicKey;
  signer: boolean;
  writable: boolean;
}

export interface ReaderTransactionMeta {
  err: unknown;
  logMessages?: string[] | null;
  preTokenBalances?: ReaderTokenBalance[] | null;
  postTokenBalances?: ReaderTokenBalance[] | null;
}

export interface ReaderTransaction {
  slot: number;
  blockTime?: number | null;
  meta: ReaderTransactionMeta | null;
  transaction: {
    signatures: string[];
    message: { accountKeys: ReaderAccountKey[] };
  };
}

export interface ReaderSignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime?: number | null;
}

/**
 * The smallest slice of a web3.js `Connection` the reader needs: list
 * signatures for an address and fetch one parsed transaction. A real
 * `Connection` satisfies this interface, so the apps pass theirs
 * straight into {@link toReaderConnection}; tests inject a fake.
 */
export interface ParsedTransactionConnection {
  getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number },
  ): Promise<ConfirmedSignatureInfo[]>;
  getParsedTransaction(
    signature: string,
  ): Promise<ParsedTransactionWithMeta | null>;
}

/**
 * Adapt a web3.js `Connection` (or any {@link ParsedTransactionConnection})
 * to the {@link ReaderConnection} the reader functions take. Fetches go
 * through `getParsedTransaction`: in web3.js v1 the parsed shape is what
 * carries `logMessages` and token balances in the form the reader reads.
 */
export function toReaderConnection(
  connection: ParsedTransactionConnection,
): ReaderConnection {
  return {
    getSignaturesForAddress: (address, options) =>
      connection.getSignaturesForAddress(address, options),
    getTransaction: (signature) =>
      connection.getParsedTransaction(signature),
  };
}

/** The Connection-like interface the reader reads through. */
export interface ReaderConnection {
  getSignaturesForAddress(
    address: PublicKey,
    options?: { limit?: number },
  ): Promise<ReaderSignatureInfo[]>;
  getTransaction(signature: string): Promise<ReaderTransaction | null>;
}

/**
 * Default number of transactions scanned per read (RPC returns newest
 * first). Kept small on purpose: a cold scan fetches one transaction
 * per signature, and the public devnet RPC allows roughly 40 requests
 * per 10 seconds per method, so 20 fetches stay comfortably inside
 * the limit. Callers that run their own RPC can raise it via
 * `scanLimit`.
 */
export const DEFAULT_SCAN_LIMIT = 20;

/** Default total attempts per transaction fetch (the first try plus retries). */
export const DEFAULT_FETCH_ATTEMPTS = 3;

/**
 * Default delay before the first fetch retry, in milliseconds; each
 * later retry waits twice as long (250ms, then 500ms).
 */
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;

/** Default number of entries returned by {@link getLeaderboard}. */
export const DEFAULT_LEADERBOARD_LIMIT = 10;

/** Default number of events returned by {@link getActivity}. */
export const DEFAULT_ACTIVITY_LIMIT = 20;

/** Options shared by every reader function. */
export interface ReaderOptions {
  /**
   * Maximum transactions to scan. The RPC returns newest first, so a
   * small limit reads only the most recent history. Defaults to
   * {@link DEFAULT_SCAN_LIMIT}.
   */
  scanLimit?: number;
  /**
   * Caller-held cache of fetched transactions, keyed by signature. A
   * refresh passes the same map back so already-fetched signatures are
   * read from the cache instead of the RPC; only new signatures are
   * fetched. Pruned transactions are cached as null; failed fetches
   * are never cached, so a refresh retries them.
   */
  cache?: Map<string, ReaderTransaction | null>;
  /**
   * Total attempts per transaction fetch before giving up on it.
   * Defaults to {@link DEFAULT_FETCH_ATTEMPTS}. Only rate-limit-looking
   * failures are retried; anything else fails after the first try.
   */
  maxFetchAttempts?: number;
  /**
   * Delay before the first fetch retry, in milliseconds; each later
   * retry waits twice as long. Defaults to
   * {@link DEFAULT_RETRY_BASE_DELAY_MS}.
   */
  retryBaseDelayMs?: number;
  /**
   * How the reader waits between retries. Defaults to a real timer;
   * tests pass a fake that records the delays instead of waiting, so
   * no test ever waits for real.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Options for {@link getLeaderboard}. */
export interface LeaderboardOptions extends ReaderOptions {
  /** Maximum entries to return. Defaults to {@link DEFAULT_LEADERBOARD_LIMIT}. */
  limit?: number;
}

/** Options for {@link getActivity}. */
export interface ActivityOptions extends ReaderOptions {
  /** Maximum events to return. Defaults to {@link DEFAULT_ACTIVITY_LIMIT}. */
  limit?: number;
}

/** The live state of a collection, counted from on-chain records. */
export interface CollectionState {
  tick: string;
  /** Maximum number of inscriptions the collection can mint. */
  supply: number;
  /** Verified inscriptions minted so far. */
  minted: number;
  /** Supply left: `supply - minted`, never below zero. */
  remaining: number;
  /** Wallets holding at least one verified inscription. */
  holders: number;
  /** Memo log lines that were not valid inscription JSON. Skipped, not fatal. */
  malformedMemos: number;
  /**
   * Inscriptions whose binding could not be verified from their
   * transaction (the memo's mint was not created in that transaction).
   * Excluded from `minted`.
   */
  unverifiedInscriptions: number;
  /**
   * Signatures the scan examined, including failed transactions skipped
   * without fetching. Always present on states built by
   * {@link getCollectionState}; optional so callers that build a state
   * by hand (views, tests) need not invent scan bookkeeping.
   */
  scanned?: number;
  /**
   * Fetches that failed even after retries. Those records could not be
   * read, so `minted` may be undercounted; callers show this honestly
   * ("some records could not be read"). Always present on states built
   * by {@link getCollectionState}.
   */
  failedFetches?: number;
}

/** One holder on the leaderboard. */
export interface LeaderboardEntry {
  wallet: string;
  /** Verified inscriptions this wallet holds in the collection. */
  count: number;
}

/** Kinds of activity the feed can show. */
export type ActivityEventType = "mint" | "transfer" | "listing" | "buy";

/** One event in the activity feed. */
export interface ActivityEvent {
  type: ActivityEventType;
  /** The transaction that produced the event. */
  signature: string;
  /** The wallet that acted (the minter, for a mint). */
  wallet: string;
  /** The carrier NFT's mint address. */
  mint: string;
  tick: string;
  /** Unix timestamp of the transaction, or null when unknown. */
  blockTime: number | null;
  slot: number;
}

/** One inscription a wallet holds in a collection. */
export interface WalletInscription {
  /** The carrier NFT's mint address. */
  mint: string;
  tick: string;
  /** The transaction that minted it. */
  signature: string;
  /** Unix timestamp of the mint transaction, or null when unknown. */
  blockTime: number | null;
  slot: number;
}

/**
 * The numbers the mint client needs before minting (see the mint
 * client's `MintLimitsChecker`): how many inscriptions exist, how many
 * are left, and how many this wallet already minted.
 */
export interface MintLimits {
  tick: string;
  /** Verified inscriptions minted so far. */
  minted: number;
  /** Maximum number of inscriptions the collection can mint. */
  supply: number;
  /** Supply left: `supply - minted`, never below zero. */
  remaining: number;
  /**
   * Verified inscriptions this wallet already minted: the inscriptions
   * whose mint transaction delivered the carrier NFT to this wallet.
   * This counts mints, not current holdings. The reader never observes
   * transfers (a transfer carries no memo, so it never enters a scan):
   * a wallet that transferred an inscription away still counts it, and
   * a wallet that received one by transfer does not count it.
   */
  mintedByWallet: number;
  /** Maximum inscriptions one wallet may mint. */
  perWalletLimit: number;
  /** Whether this wallet may mint one more inscription right now. */
  canMint: boolean;
  /** Plain-words reason when `canMint` is false, otherwise null. */
  reason: string | null;
}

/** One verified inscription found by a scan. */
interface ScannedInscription {
  inscription: Inscription;
  mint: string;
  holder: string;
  signature: string;
  blockTime: number | null;
  slot: number;
}

/** Everything one scan of the chain found. */
interface ScanResult {
  /** Verified inscriptions, one per carrier NFT mint. */
  inscriptions: ScannedInscription[];
  malformedMemos: number;
  unverifiedInscriptions: number;
  /** Signatures the scan examined. */
  scanned: number;
  /** Fetches that failed even after retries. */
  failedFetches: number;
}

/** The memo program's log line shape (see research §2.4). */
const MEMO_LOG_PATTERN = /^Program log: Memo \(len \d+\): (.*)$/;

/**
 * Extract the memo texts from a transaction's log messages. Each memo
 * log line carries the memo as a quoted, escaped string; unescaping it
 * is a JSON parse of the quoted payload. A line whose payload does not
 * unescape is reported as malformed by returning null for that line.
 */
function extractMemos(logMessages: string[]): Array<string | null> {
  const memos: Array<string | null> = [];
  for (const line of logMessages) {
    const match = MEMO_LOG_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    try {
      const memo: unknown = JSON.parse(match[1] as string);
      memos.push(typeof memo === "string" ? memo : null);
    } catch {
      memos.push(null);
    }
  }
  return memos;
}

/**
 * Verify the binding convention (ADR 0002) for a parsed inscription in
 * its transaction: the memo's mint must appear in the transaction's
 * post-token-balances (the NFT exists after the transaction) and must
 * not appear in its pre-token-balances (it was created by this
 * transaction, not moved by it). Returns the matching balance entry
 * when verified, so the caller can read the holder from it.
 */
function verifyBinding(
  inscription: Inscription,
  meta: ReaderTransactionMeta,
): ReaderTokenBalance | null {
  const postBalances = meta.postTokenBalances ?? [];
  const entry = postBalances.find(
    (balance) => balance.mint === inscription.mint,
  );
  if (entry === undefined) {
    return null;
  }
  const preBalances = meta.preTokenBalances ?? [];
  if (preBalances.some((balance) => balance.mint === inscription.mint)) {
    return null;
  }
  return entry;
}

/**
 * Work out who holds a freshly minted inscription: the owner of the
 * token account that received the carrier NFT, falling back to the
 * transaction's first signer (the fee payer) when the balance entry
 * carries no owner. Returns null when no holder can be determined.
 */
function findHolder(
  entry: ReaderTokenBalance,
  transaction: ReaderTransaction,
): string | null {
  if (entry.owner !== undefined && entry.owner.length > 0) {
    return entry.owner;
  }
  const signer = transaction.transaction.message.accountKeys.find(
    (key) => key.signer,
  );
  if (signer !== undefined) {
    return signer.pubkey.toBase58();
  }
  const firstKey = transaction.transaction.message.accountKeys[0];
  return firstKey === undefined ? null : firstKey.pubkey.toBase58();
}

/** The default sleep: a real timer. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a fetch failure looks like the public RPC shedding load: a
 * 429, a rate-limit message, or a dropped connection (the live probe
 * saw both 429s and plain "fetch failed" errors under load). Only
 * these are worth retrying; anything else fails fast.
 */
function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|too many requests|fetch failed/i.test(message);
}

/**
 * Fetch one transaction, retrying rate-limit-looking failures with
 * exponential backoff (the base delay, then double each time) until
 * the attempt budget runs out. Throws the last error when it gives up.
 */
async function fetchTransactionWithRetry(
  connection: ReaderConnection,
  signature: string,
  maxAttempts: number,
  baseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<ReaderTransaction | null> {
  let delayMs = baseDelayMs;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connection.getTransaction(signature);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error;
      }
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

/**
 * Scan the chain for a collection's inscriptions: list recent memo
 * transactions, fetch each one, and keep the verified inscriptions.
 * Malformed memos are skipped and counted; failed transactions are
 * ignored; a transaction that can no longer be fetched (pruned) is
 * skipped. A fetch that fails is skipped and counted, never fatal:
 * only a failed signature listing fails the whole scan (as an
 * `rpc-error`), because without it there is nothing to scan at all.
 */
async function scanCollection(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: ReaderOptions,
): Promise<ScanResult> {
  const scanLimit = options?.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const cache = options?.cache;
  const maxFetchAttempts = Math.max(
    1,
    options?.maxFetchAttempts ?? DEFAULT_FETCH_ATTEMPTS,
  );
  const retryBaseDelayMs =
    options?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const sleep = options?.sleep ?? defaultSleep;
  let signatures: ReaderSignatureInfo[];
  try {
    signatures = await connection.getSignaturesForAddress(
      new PublicKey(MEMO_PROGRAM_ID),
      { limit: scanLimit },
    );
  } catch (error) {
    throw new ReaderError("rpc-error", NETWORK_UNREACHABLE_MESSAGE, {
      cause: error,
    });
  }

  const byMint = new Map<string, ScannedInscription>();
  let malformedMemos = 0;
  let unverifiedInscriptions = 0;
  let scanned = 0;
  let failedFetches = 0;

  for (const info of signatures) {
    scanned += 1;
    // A failed transaction never minted anything; skip it without fetching.
    if (info.err !== null && info.err !== undefined) {
      continue;
    }
    let transaction: ReaderTransaction | null;
    const cached = cache?.get(info.signature);
    if (cached !== undefined) {
      // Already fetched on an earlier scan (null means pruned).
      transaction = cached;
    } else {
      try {
        transaction = await fetchTransactionWithRetry(
          connection,
          info.signature,
          maxFetchAttempts,
          retryBaseDelayMs,
          sleep,
        );
      } catch {
        // One unreadable record must not sink the whole scan: the public
        // RPC rate-limits bursts of fetches, so a failed fetch is skipped
        // and counted, and the caller reports it honestly. It is not
        // cached, so a refresh retries it.
        failedFetches += 1;
        continue;
      }
      cache?.set(info.signature, transaction);
    }
    if (transaction === null || transaction.meta === null) {
      continue;
    }
    if (transaction.meta.err !== null && transaction.meta.err !== undefined) {
      continue;
    }
    const memos = extractMemos(transaction.meta.logMessages ?? []);
    for (const memo of memos) {
      if (memo === null) {
        malformedMemos += 1;
        continue;
      }
      const parsed = parseInscription(memo);
      if (!parsed.ok) {
        malformedMemos += 1;
        continue;
      }
      // A memo for another collection is not malformed; it is just not ours.
      if (!verifyInscription(parsed.inscription, config.tick).ok) {
        continue;
      }
      const entry = verifyBinding(parsed.inscription, transaction.meta);
      if (entry === null) {
        unverifiedInscriptions += 1;
        continue;
      }
      const holder = findHolder(entry, transaction);
      if (holder === null) {
        unverifiedInscriptions += 1;
        continue;
      }
      // One carrier NFT is one inscription: keep the first record seen
      // for a mint (the scan runs newest first).
      if (!byMint.has(parsed.inscription.mint)) {
        byMint.set(parsed.inscription.mint, {
          inscription: parsed.inscription,
          mint: parsed.inscription.mint,
          holder,
          signature: info.signature,
          blockTime: transaction.blockTime ?? null,
          slot: transaction.slot,
        });
      }
    }
  }

  return {
    inscriptions: [...byMint.values()],
    malformedMemos,
    unverifiedInscriptions,
    scanned,
    failedFetches,
  };
}

/** Newest first: later block time first, unknown times last, ties by slot. */
function byNewestFirst(
  a: { blockTime: number | null; slot: number },
  b: { blockTime: number | null; slot: number },
): number {
  if (a.blockTime !== null && b.blockTime !== null) {
    if (a.blockTime !== b.blockTime) {
      return b.blockTime - a.blockTime;
    }
  } else if (a.blockTime === null && b.blockTime !== null) {
    return 1;
  } else if (a.blockTime !== null && b.blockTime === null) {
    return -1;
  }
  return b.slot - a.slot;
}

/** Validate a wallet address and return its canonical base58 form. */
function normalizeWallet(wallet: string): string {
  try {
    return new PublicKey(wallet).toBase58();
  } catch {
    throw new ReaderError(
      "invalid-wallet",
      `Invalid wallet address "${wallet}": a wallet address must be a valid Solana address.`,
    );
  }
}

/**
 * Count a collection's state from on-chain records: how many
 * inscriptions are minted, how much supply is left, and how many
 * holders there are. Malformed memos and unverified inscriptions are
 * reported, not hidden.
 */
export async function getCollectionState(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: ReaderOptions,
): Promise<CollectionState> {
  const scan = await scanCollection(connection, config, options);
  const minted = scan.inscriptions.length;
  const holders = new Set(scan.inscriptions.map((entry) => entry.holder)).size;
  return {
    tick: config.tick,
    supply: config.supply,
    minted,
    remaining: Math.max(0, config.supply - minted),
    holders,
    malformedMemos: scan.malformedMemos,
    unverifiedInscriptions: scan.unverifiedInscriptions,
    scanned: scan.scanned,
    failedFetches: scan.failedFetches,
  };
}

/**
 * The holder leaderboard: wallets ordered by inscription count, most
 * first, ties broken by wallet address so the order is stable.
 */
export async function getLeaderboard(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: LeaderboardOptions,
): Promise<LeaderboardEntry[]> {
  const scan = await scanCollection(connection, config, options);
  const counts = new Map<string, number>();
  for (const entry of scan.inscriptions) {
    counts.set(entry.holder, (counts.get(entry.holder) ?? 0) + 1);
  }
  const limit = options?.limit ?? DEFAULT_LEADERBOARD_LIMIT;
  return [...counts.entries()]
    .map(([wallet, count]) => ({ wallet, count }))
    .sort((a, b) => b.count - a.count || a.wallet.localeCompare(b.wallet))
    .slice(0, limit);
}

/**
 * Recent activity, newest first.
 *
 * This release only observes mint events: the inscription library only
 * supports the `mint` operation, and there is no market program yet to
 * produce listing or buy events (ticket 07). Transfer, listing, and buy
 * events are part of the {@link ActivityEventType} shape so the feed can
 * grow into them without changing its callers.
 */
export async function getActivity(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: ActivityOptions,
): Promise<ActivityEvent[]> {
  const scan = await scanCollection(connection, config, options);
  const limit = options?.limit ?? DEFAULT_ACTIVITY_LIMIT;
  return scan.inscriptions
    .map((entry) => ({
      type: "mint" as const,
      signature: entry.signature,
      wallet: entry.holder,
      mint: entry.mint,
      tick: config.tick,
      blockTime: entry.blockTime,
      slot: entry.slot,
    }))
    .sort(byNewestFirst)
    .slice(0, limit);
}

/**
 * List one wallet's inscriptions in a collection, newest first.
 * Throws a {@link ReaderError} (`invalid-wallet`) for a malformed
 * wallet address.
 */
export async function lookupWallet(
  connection: ReaderConnection,
  config: CollectionConfig,
  wallet: string,
  options?: ReaderOptions,
): Promise<WalletInscription[]> {
  const normalized = normalizeWallet(wallet);
  const scan = await scanCollection(connection, config, options);
  return scan.inscriptions
    .filter((entry) => entry.holder === normalized)
    .map((entry) => ({
      mint: entry.mint,
      tick: config.tick,
      signature: entry.signature,
      blockTime: entry.blockTime,
      slot: entry.slot,
    }))
    .sort(byNewestFirst);
}

/**
 * The mint limits for one wallet in one collection: the minted total,
 * the supply, and how many that wallet already minted, plus whether
 * the wallet may mint one more right now and the plain-words reason
 * when it may not.
 *
 * "How many that wallet already minted" counts the inscriptions whose
 * mint transaction delivered the carrier NFT to this wallet. It is a
 * mint count, not a holdings count: transfers after minting are never
 * observed, so they never change it (see `MintLimits.mintedByWallet`).
 *
 * This is the shape the mint client needs for its limit check (its
 * `MintLimitsChecker`): the client calls this before building a mint
 * transaction and refuses with `reason` when `canMint` is false.
 * Throws a {@link ReaderError} (`invalid-wallet`) for a malformed
 * wallet address.
 */
export async function getMintLimits(
  connection: ReaderConnection,
  config: CollectionConfig,
  wallet: string,
  options?: ReaderOptions,
): Promise<MintLimits> {
  const normalized = normalizeWallet(wallet);
  const scan = await scanCollection(connection, config, options);
  const minted = scan.inscriptions.length;
  const remaining = Math.max(0, config.supply - minted);
  const mintedByWallet = scan.inscriptions.filter(
    (entry) => entry.holder === normalized,
  ).length;
  let canMint = true;
  let reason: string | null = null;
  if (remaining <= 0) {
    canMint = false;
    reason =
      `Supply exhausted: all ${config.supply} ${config.tick} inscriptions ` +
      `are minted.`;
  } else if (mintedByWallet >= config.perWalletLimit) {
    canMint = false;
    reason =
      `Per-wallet limit reached: this wallet already minted ` +
      `${mintedByWallet} of ${config.perWalletLimit} allowed ${config.tick} ` +
      `inscriptions.`;
  }
  return {
    tick: config.tick,
    minted,
    supply: config.supply,
    remaining,
    mintedByWallet,
    perWalletLimit: config.perWalletLimit,
    canMint,
    reason,
  };
}
