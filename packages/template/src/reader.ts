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
 * only new transactions. Fetches run with bounded concurrency, and
 * {@link getCollectionOverview} derives state, leaderboard, and
 * activity from a single scan, so a page refresh makes one pass over
 * the chain instead of three (see ADR 0011). The reader never trusts
 * client input: every count comes from the chain (or, in tests, from
 * recorded fixture transactions).
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

/**
 * Default number of transaction fetches in flight at once. The public
 * RPC answers one fetch in a few hundred milliseconds, so fetching
 * twenty transactions one at a time costs seconds; five at a time
 * stays well inside the per-method rate limit while cutting the scan
 * to a few seconds. See ADR 0011.
 */
export const DEFAULT_FETCH_CONCURRENCY = 5;

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
   * Transaction fetches in flight at once. Defaults to
   * {@link DEFAULT_FETCH_CONCURRENCY}. Fetching is the only parallel
   * part of a scan: parsing still walks the signatures newest first,
   * so a duplicate mint keeps its newest record.
   */
  fetchConcurrency?: number;
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
  /**
   * Verified inscriptions found through the collection's known-
   * inscription registry (`knownInscriptions`) rather than the live
   * memo scan: older mints the live window can no longer reach. They
   * are verified exactly like scanned ones and are included in
   * `minted`; this count only says where they came from. Always
   * present on states built by {@link getCollectionState}.
   */
  fromRegistry?: number;
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
  /**
   * Verified inscriptions found through the registry that the live
   * scan did not already find (a registered signature that is still
   * inside the live window counts as scanned, not registered).
   */
  registeredInscriptions: number;
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
 * Fetch a batch of transactions with bounded concurrency: `concurrency`
 * workers pull signatures from the list until it is empty. Successful
 * fetches (including null, for pruned transactions) land in the
 * returned map and in the cache as they complete; a fetch that fails
 * even after retries is simply absent from the map, never fatal, and
 * never cached, so a refresh retries it.
 */
async function fetchTransactions(
  connection: ReaderConnection,
  signatures: string[],
  maxAttempts: number,
  baseDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  concurrency: number,
  cache: Map<string, ReaderTransaction | null> | undefined,
): Promise<Map<string, ReaderTransaction | null>> {
  const fetched = new Map<string, ReaderTransaction | null>();
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, signatures.length) },
    async () => {
      // `next` is only touched synchronously between awaits, so two
      // workers never take the same index.
      while (next < signatures.length) {
        const index = next;
        next += 1;
        const signature = signatures[index] as string;
        try {
          const transaction = await fetchTransactionWithRetry(
            connection,
            signature,
            maxAttempts,
            baseDelayMs,
            sleep,
          );
          fetched.set(signature, transaction);
          cache?.set(signature, transaction);
        } catch {
          // Absent from `fetched`: the caller skips and counts it.
        }
      }
    },
  );
  await Promise.all(workers);
  return fetched;
}

/**
 * Scan the chain for a collection's inscriptions: list recent memo
 * transactions, fetch each one, and keep the verified inscriptions.
 * Malformed memos are skipped and counted; failed transactions are
 * ignored; a transaction that can no longer be fetched (pruned) is
 * skipped. A fetch that fails is skipped and counted, never fatal:
 * only a failed signature listing fails the whole scan (as an
 * `rpc-error`), because without it there is nothing to scan at all.
 * After the live scan, the collection's known-inscription registry
 * (`knownInscriptions`) is fetched directly by signature and merged
 * in the same way, so mints that aged out of the live window stay
 * visible (see ADR 0015).
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
  const fetchConcurrency = Math.max(
    1,
    options?.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY,
  );
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

  // Fetch the transactions the cache does not have yet, with bounded
  // concurrency: one fetch costs a few hundred milliseconds against
  // the public RPC, so twenty sequential fetches cost seconds, and
  // the memo window slides while they run (each scan's "last 20" is a
  // mostly new set). Fetching is the only parallel part: parsing
  // below still walks the signatures newest first.
  const toFetch = signatures
    .filter(
      (info) =>
        (info.err === null || info.err === undefined) &&
        cache?.get(info.signature) === undefined,
    )
    .map((info) => info.signature);
  const fetched = await fetchTransactions(
    connection,
    toFetch,
    maxFetchAttempts,
    retryBaseDelayMs,
    sleep,
    fetchConcurrency,
    cache,
  );

  const byMint = new Map<string, ScannedInscription>();
  let malformedMemos = 0;
  let unverifiedInscriptions = 0;
  let scanned = 0;
  let failedFetches = 0;

  // Resolve a signature to its transaction: the cache first, then this
  // scan's fetch results. Returns "failed" when the fetch failed even
  // after retries (absent from both, never cached, so a refresh retries
  // it); returns null when the transaction is gone (pruned).
  const resolveTransaction = (
    signature: string,
    fetchedMap: Map<string, ReaderTransaction | null>,
  ): ReaderTransaction | null | "failed" => {
    const cached = cache?.get(signature);
    if (cached !== undefined) {
      // Already fetched on an earlier scan (null means pruned).
      return cached;
    }
    if (fetchedMap.has(signature)) {
      // Fetched in this scan. (Only reachable without a cache: with
      // one, the fetch phase cached it, so the branch above hit.)
      return fetchedMap.get(signature) ?? null;
    }
    return "failed";
  };

  // Consider one transaction for the collection: extract its memos,
  // keep the verified inscriptions for this collection, and count the
  // rest honestly. Returns how many NEW inscriptions it added (a mint
  // already found keeps its first record). The live scan and the
  // registry share this path, so a registered inscription is verified
  // exactly like a scanned one.
  const considerTransaction = (
    signature: string,
    transaction: ReaderTransaction | null,
  ): number => {
    if (transaction === null || transaction.meta === null) {
      return 0;
    }
    if (transaction.meta.err !== null && transaction.meta.err !== undefined) {
      return 0;
    }
    let added = 0;
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
          signature,
          blockTime: transaction.blockTime ?? null,
          slot: transaction.slot,
        });
        added += 1;
      }
    }
    return added;
  };

  for (const info of signatures) {
    scanned += 1;
    // A failed transaction never minted anything; skip it without fetching.
    if (info.err !== null && info.err !== undefined) {
      continue;
    }
    const transaction = resolveTransaction(info.signature, fetched);
    if (transaction === "failed") {
      // One unreadable record must not sink the whole scan: it is
      // skipped and counted, and the caller reports it honestly.
      failedFetches += 1;
      continue;
    }
    considerTransaction(info.signature, transaction);
  }

  // The registry: mint transactions the collection knows about, fetched
  // directly by signature. The live window above only covers the most
  // recent memo transactions, and on a busy network it slides past a
  // mint within seconds (see ADR 0015); a registered mint stays
  // visible however old it gets. A registered signature that is still
  // inside the live window was already fetched above, so it is not
  // fetched twice and counts as scanned, not registered.
  const liveSignatures = new Set(signatures.map((info) => info.signature));
  const knownSignatures = (config.knownInscriptions ?? []).filter(
    (signature) => !liveSignatures.has(signature),
  );
  const knownToFetch = knownSignatures.filter(
    (signature) => cache?.get(signature) === undefined,
  );
  const knownFetched = await fetchTransactions(
    connection,
    knownToFetch,
    maxFetchAttempts,
    retryBaseDelayMs,
    sleep,
    fetchConcurrency,
    cache,
  );
  let registeredInscriptions = 0;
  for (const signature of knownSignatures) {
    scanned += 1;
    const transaction = resolveTransaction(signature, knownFetched);
    if (transaction === "failed") {
      failedFetches += 1;
      continue;
    }
    registeredInscriptions += considerTransaction(signature, transaction);
  }

  return {
    inscriptions: [...byMint.values()],
    malformedMemos,
    unverifiedInscriptions,
    scanned,
    failedFetches,
    registeredInscriptions,
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

/** Count a collection's state from one scan's verified inscriptions. */
function stateFromScan(
  scan: ScanResult,
  config: CollectionConfig,
): CollectionState {
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
    fromRegistry: scan.registeredInscriptions,
  };
}

/** The holder leaderboard from one scan's verified inscriptions. */
function leaderboardFromScan(
  scan: ScanResult,
  limit: number,
): LeaderboardEntry[] {
  const counts = new Map<string, number>();
  for (const entry of scan.inscriptions) {
    counts.set(entry.holder, (counts.get(entry.holder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([wallet, count]) => ({ wallet, count }))
    .sort((a, b) => b.count - a.count || a.wallet.localeCompare(b.wallet))
    .slice(0, limit);
}

/** Recent mint activity from one scan's verified inscriptions. */
function activityFromScan(
  scan: ScanResult,
  config: CollectionConfig,
  limit: number,
): ActivityEvent[] {
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
  return stateFromScan(scan, config);
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
  return leaderboardFromScan(
    scan,
    options?.limit ?? DEFAULT_LEADERBOARD_LIMIT,
  );
}

/**
 * Recent activity, newest first.
 *
 * This release only observes mint events: the inscription library only
 * supports the `mint` operation, and the reader does not scan market
 * program transactions, so listing and buy events are not observed
 * yet. Transfer, listing, and buy events are part of the
 * {@link ActivityEventType} shape so the feed can grow into them
 * without changing its callers.
 */
export async function getActivity(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: ActivityOptions,
): Promise<ActivityEvent[]> {
  const scan = await scanCollection(connection, config, options);
  return activityFromScan(
    scan,
    config,
    options?.limit ?? DEFAULT_ACTIVITY_LIMIT,
  );
}

/**
 * State, leaderboard, and activity from a single scan: one signature
 * listing and one set of transaction fetches, shared by all three
 * views. A page refresh used to run three separate scans, and the memo
 * window slides while they run, so each scan fetched a mostly new set
 * of transactions (about 30 seconds on the public devnet RPC under
 * load, and longer where the RPC rate-limits harder). See ADR 0011.
 */
export interface CollectionOverview {
  state: CollectionState;
  leaderboard: LeaderboardEntry[];
  activity: ActivityEvent[];
}

/** Options for {@link getCollectionOverview}. */
export interface OverviewOptions extends ReaderOptions {
  /** Maximum leaderboard entries. Defaults to {@link DEFAULT_LEADERBOARD_LIMIT}. */
  leaderboardLimit?: number;
  /** Maximum activity events. Defaults to {@link DEFAULT_ACTIVITY_LIMIT}. */
  activityLimit?: number;
}

export async function getCollectionOverview(
  connection: ReaderConnection,
  config: CollectionConfig,
  options?: OverviewOptions,
): Promise<CollectionOverview> {
  const scan = await scanCollection(connection, config, options);
  return {
    state: stateFromScan(scan, config),
    leaderboard: leaderboardFromScan(
      scan,
      options?.leaderboardLimit ?? DEFAULT_LEADERBOARD_LIMIT,
    ),
    activity: activityFromScan(
      scan,
      config,
      options?.activityLimit ?? DEFAULT_ACTIVITY_LIMIT,
    ),
  };
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
