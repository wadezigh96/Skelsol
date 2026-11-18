import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import type { Network } from "./config.js";
import type { ActivityEvent, CollectionState } from "./reader.js";

/**
 * Shared UI helpers for the Skelsol web apps (the spooky UI kit's
 * logic half; the theme CSS lives in `ui/spooky.css`).
 *
 * Pure functions only, so both apps format numbers, addresses, and
 * explorer links the same way. No DOM, no network: unit-tested.
 */

/** Base URL of the Solana block explorer. */
const EXPLORER_BASE_URL = "https://explorer.solana.com";

/**
 * Format a lamport amount as SOL, e.g. `1_500_000_000` becomes
 * `"1.5 SOL"` and `0` becomes `"0 SOL"`. Whole SOL amounts get
 * thousands separators; fractional amounts show up to 9 decimals with
 * trailing zeroes trimmed.
 */
export function formatLamports(lamports: number): string {
  // The sign is handled explicitly, like the bigint version below:
  // `Math.trunc` of a negative sub-1-SOL amount is -0, and relying on
  // `toLocaleString` to print "-0" for it is an environment detail,
  // not a guarantee.
  const negative = lamports < 0;
  const magnitude = Math.abs(lamports);
  const whole = Math.trunc(magnitude / LAMPORTS_PER_SOL);
  const remainder = magnitude % LAMPORTS_PER_SOL;
  const sign = negative ? "-" : "";
  const wholeText = whole.toLocaleString("en-US");
  if (remainder === 0) {
    return `${sign}${wholeText} SOL`;
  }
  const fractionText = remainder
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${sign}${wholeText}.${fractionText} SOL`;
}

/**
 * Lamports per SOL as a bigint, for exact big-price formatting. The
 * one canonical bigint constant: consumers import this instead of
 * keeping their own copy.
 */
export const LAMPORTS_PER_SOL_BIGINT = BigInt(LAMPORTS_PER_SOL);

/** Group a decimal digit string with thousands separators: `"4444"` → `"4,444"`. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a bigint lamport amount as SOL, e.g. `1_500_000_000n` becomes
 * `"1.5 SOL"` and `0n` becomes `"0 SOL"`. Same shape as
 * {@link formatLamports}, but exact for any u64 value: market prices
 * are bigints, and converting one to a number would silently round
 * prices above `Number.MAX_SAFE_INTEGER`. Whole SOL amounts get
 * thousands separators; fractional amounts show up to 9 decimals with
 * trailing zeroes trimmed.
 */
export function formatLamportsBigint(lamports: bigint): string {
  const negative = lamports < 0n;
  const magnitude = negative ? -lamports : lamports;
  const whole = magnitude / LAMPORTS_PER_SOL_BIGINT;
  const remainder = magnitude % LAMPORTS_PER_SOL_BIGINT;
  const sign = negative ? "-" : "";
  const wholeText = groupThousands(whole.toString());
  if (remainder === 0n) {
    return `${sign}${wholeText} SOL`;
  }
  const fractionText = remainder
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${sign}${wholeText}.${fractionText} SOL`;
}

/**
 * Shorten a long address to its first and last `chars` characters
 * (4 by default), joined by an ellipsis: `"BYMf…dgXg"`. Addresses
 * short enough to show in full are returned untouched.
 */
export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 1) {
    return address;
  }
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/**
 * The explorer URL for a transaction signature on a network. Devnet
 * links carry `?cluster=devnet`; mainnet is the explorer's default
 * cluster, so mainnet links carry no cluster parameter.
 */
export function explorerTransactionUrl(
  signature: string,
  network: Network,
): string {
  const cluster = network === "devnet" ? "?cluster=devnet" : "";
  return `${EXPLORER_BASE_URL}/tx/${signature}${cluster}`;
}

/**
 * The explorer URL for an address (a wallet or a mint) on a network.
 * Same cluster rule as {@link explorerTransactionUrl}.
 */
export function explorerAddressUrl(
  address: string,
  network: Network,
): string {
  const cluster = network === "devnet" ? "?cluster=devnet" : "";
  return `${EXPLORER_BASE_URL}/address/${address}${cluster}`;
}

/** Format a count with thousands separators: `4444` becomes `"4,444"`. */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

/** The market numbers the stats row shows, when the market reports any. */
export interface MarketStats {
  listings: number;
  /**
   * Floor price in lamports, or null when there are no listings. A
   * bigint when the caller prices in bigint lamports (the market),
   * a number otherwise (Ghost Mint's whole-number market reads).
   */
  floorLamports: number | bigint | null;
}

/** The stats row, as display strings. */
export interface StatsView {
  minted: string;
  /**
   * Wallets that minted at least one inscription. The reader never
   * observes transfers, so this counts minters, not current holders:
   * the label says "Minters", never "Holders".
   */
  minters: string;
  inscriptions: string;
  listings: string;
  floor: string;
}

/**
 * Map collection state (and optional market numbers) to the stats row.
 * Without market numbers the row shows 0 listings and a dash floor:
 * the market program is not deployed yet, so there is no listing data
 * to show (see the "market coming soon" note in the page). The market
 * app builds its own row on top of this one: it passes its listings
 * through `market` when deployed, and overrides both market cells with
 * dashes when the program is not deployed at all.
 */
export function statsViewModel(
  state: CollectionState,
  market?: MarketStats,
): StatsView {
  return {
    minted: `${formatCount(state.minted)} / ${formatCount(state.supply)}`,
    // The reader's `holders` field counts the wallets its mint scan
    // attributed inscriptions to; the display name is "Minters".
    minters: formatCount(state.holders),
    inscriptions: formatCount(state.minted),
    listings: formatCount(market?.listings ?? 0),
    floor:
      market?.floorLamports === undefined ||
      market.floorLamports === null
        ? "—"
        : typeof market.floorLamports === "bigint"
          ? formatLamportsBigint(market.floorLamports)
          : formatLamports(market.floorLamports),
  };
}

/** One line describing an activity event, with shortened addresses. */
export function activityLabel(event: ActivityEvent): string {
  const wallet = shortenAddress(event.wallet);
  const mint = shortenAddress(event.mint);
  switch (event.type) {
    case "mint":
      return `Mint · ${wallet} minted ${mint}`;
    case "transfer":
      return `Transfer · ${wallet} moved ${mint}`;
    case "listing":
      return `Listing · ${wallet} listed ${mint}`;
    case "buy":
      return `Buy · ${wallet} bought ${mint}`;
  }
}

/**
 * A relative time for a block timestamp (`nowSeconds` is the current
 * Unix time, passed in so tests can pin it): "just now", "5m ago",
 * "3h ago", "2d ago", or "unknown time" when the block time is missing.
 */
export function timeAgo(
  blockTime: number | null,
  nowSeconds: number,
): string {
  if (blockTime === null) {
    return "unknown time";
  }
  const seconds = Math.max(0, nowSeconds - blockTime);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}
