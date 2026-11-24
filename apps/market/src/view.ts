import type {
  CollectionState,
  Listing,
  Network,
  StatsView,
  WalletInscription,
} from "@skelsol/template";
import {
  feeSplit,
  formatLamportsBigint,
  shortenAddress,
  statsViewModel as templateStatsViewModel,
} from "@skelsol/template";

/**
 * Pure view logic for the Inscription Market: the display strings the
 * page shows, the price parsing, and the market-specific row mapping.
 * The shared display helpers (`formatCount`, `activityLabel`,
 * `timeAgo`, and the base `statsViewModel`) live in the template's UI
 * kit (`@skelsol/template`); the fee split lives in the template's
 * market module. No DOM here, so every function is unit-tested;
 * `main.ts` owns the DOM and calls these.
 *
 * Prices are bigint lamports end to end (see market.ts): they are
 * never converted to `number`, which would silently round prices
 * above `Number.MAX_SAFE_INTEGER`.
 */

/** Largest value a u64 price can hold. */
const MAX_U64 = (1n << 64n) - 1n;

/** Lamports per SOL, as a bigint. */
const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

/** The result of parsing a price the user typed. */
export type PriceParseResult =
  | { ok: true; lamports: bigint }
  | { ok: false; error: string };

/**
 * Parse a price typed in SOL (e.g. `"0.5"`, `"2"`) into bigint
 * lamports. The parse is decimal-string arithmetic, never a float:
 * `"0.3"` becomes exactly `300_000_000n`. Rejects empty input,
 * non-numeric input, negatives, more than 9 decimal places (1 lamport
 * is 0.000000001 SOL), and prices above the u64 maximum, each with a
 * plain-words error.
 */
export function parseSolPrice(input: string): PriceParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a price in SOL." };
  }
  const parts = trimmed.split(".");
  if (parts.length > 2) {
    return { ok: false, error: "Enter a price in SOL, like 0.5 or 2." };
  }
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  const digits = /^\d*$/;
  if (
    !digits.test(whole) ||
    !digits.test(fraction) ||
    whole.length + fraction.length === 0
  ) {
    return { ok: false, error: "Enter a price in SOL, like 0.5 or 2." };
  }
  if (fraction.length > 9) {
    return {
      ok: false,
      error:
        "A price can have at most 9 decimal places: 1 lamport is 0.000000001 SOL.",
    };
  }
  // The fraction is padded to 9 digits before slicing, so the sliced
  // string is always 9 digits long, never empty.
  const lamports =
    BigInt(whole === "" ? "0" : whole) * LAMPORTS_PER_SOL_BIGINT +
    BigInt((fraction + "000000000").slice(0, 9));
  if (lamports > MAX_U64) {
    return {
      ok: false,
      error:
        "That price is too large: the largest price is " +
        `${formatLamportsBigint(MAX_U64)}.`,
    };
  }
  return { ok: true, lamports };
}

/** A sale preview, as display strings. */
export interface SalePreview {
  /** The full price the buyer pays. */
  total: string;
  /** The 1% fee, paid to the treasury. */
  fee: string;
  /** What the seller receives after the fee. */
  sellerReceives: string;
}

/**
 * Format a sale price as a preview: total, fee, and seller's share.
 * The split comes from the template's `feeSplit` (1% to the treasury,
 * rounded down, the rest to the seller), so the preview and the
 * program can never disagree about the fee.
 */
export function salePreview(price: bigint): SalePreview {
  const split = feeSplit(price);
  return {
    total: formatLamportsBigint(price),
    fee: formatLamportsBigint(split.fee),
    sellerReceives: formatLamportsBigint(split.sellerAmount),
  };
}

/** One listing row, as display strings. */
export interface ListingRow {
  /** Shortened seller address. */
  seller: string;
  /** Full seller address, for the explorer link. */
  sellerAddress: string;
  /** Shortened carrier NFT mint. */
  mint: string;
  /** Full mint address, for the explorer link. */
  mintAddress: string;
  /** Inscriptions in the listing: always 1, one carrier NFT. */
  amount: string;
  /** Fixed sale price, in SOL. */
  price: string;
  /** What the buyer pays: the price, no extras. */
  total: string;
  /** True when the listing belongs to the connected wallet. */
  isOwn: boolean;
}

/**
 * Map a listing to its table row. The total equals the price: a
 * fixed-price sale charges exactly the listed price, and the 1% fee
 * comes out of the seller's share, not on top of the buyer's payment.
 */
export function listingRow(
  listing: Listing,
  connectedWallet: string | null,
): ListingRow {
  const price = formatLamportsBigint(listing.price);
  const sellerAddress = listing.seller.toBase58();
  const mintAddress = listing.mint.toBase58();
  return {
    seller: shortenAddress(sellerAddress),
    sellerAddress,
    mint: shortenAddress(mintAddress),
    mintAddress,
    amount: "1",
    price,
    total: price,
    isOwn: connectedWallet !== null && sellerAddress === connectedWallet,
  };
}

/**
 * Order listings cheapest first (the floor price on top), ties broken
 * by mint address so the order is stable. Returns a new array; the
 * input is untouched.
 */
export function sortListings(listings: Listing[]): Listing[] {
  return [...listings].sort((a, b) => {
    if (a.price !== b.price) {
      return a.price < b.price ? -1 : 1;
    }
    return a.mint.toBase58().localeCompare(b.mint.toBase58());
  });
}

/**
 * The floor price: the lowest price among the listings, or null when
 * there are none. Computed from already-fetched listings, so the page
 * does not make a second RPC round trip for it.
 */
export function floorPrice(listings: Listing[]): bigint | null {
  let floor: bigint | null = null;
  for (const listing of listings) {
    if (floor === null || listing.price < floor) {
      floor = listing.price;
    }
  }
  return floor;
}

/**
 * Whether the market program is deployed on the current network.
 * `"not-deployed"` is a different state from a deployed-but-empty
 * market: the stats row shows dashes for it, never zeroes, so the page
 * never pretends an undeployed market has no listings.
 */
export type MarketAvailability = "deployed" | "not-deployed";

/**
 * Map collection state and market listings to the stats row, on top of
 * the template's shared row. When the program is not deployed, the
 * listings and floor cells show dashes: there is no market data at
 * all, which is not the same as an empty market (0 listings, dash
 * floor).
 */
export function statsViewModel(
  state: CollectionState,
  availability: MarketAvailability,
  listings: Listing[],
): StatsView {
  if (availability === "not-deployed") {
    return {
      ...templateStatsViewModel(state),
      listings: "—",
      floor: "—",
    };
  }
  return templateStatsViewModel(state, {
    listings: listings.length,
    floorLamports: floorPrice(listings),
  });
}

/** The notice shown when the market program is not deployed yet. */
export function marketUnavailableText(network: Network): string {
  return (
    `The market program is not deployed on ${network} yet, so there are ` +
    `no listings to show. Listing, buying, and cancelling will work ` +
    `once the program is deployed.`
  );
}

/**
 * The warning banner shown while the app is on mainnet: real money,
 * and the demo collection lives on devnet. Shown by
 * `updateNetworkGuard` in `main.ts`.
 */
export function mainnetWarningText(): string {
  return (
    "You are on mainnet: transactions here use real SOL. " +
    "This demo collection (GHOST) lives on devnet — listing, buying, " +
    "and cancelling are disabled here. Switch back to devnet to try " +
    "the demo for free."
  );
}

/** The sell form's note while the app is on mainnet. */
export function mainnetTradingDisabledText(): string {
  return (
    "Listing, buying, and cancelling are disabled on mainnet. " +
    "Switch back to devnet to trade."
  );
}

/** The empty state shown when the market is deployed but has no listings. */
export function emptyListingsText(): string {
  return "No listings yet. List a carrier NFT below to open the first one.";
}

/** One carrier NFT the connected wallet can list. */
export interface SellCandidate {
  /** The carrier NFT's mint address. */
  mint: string;
  /** The option label shown in the sell form. */
  label: string;
}

/**
 * The carrier NFTs the connected wallet can list: the inscriptions it
 * owns, minus the ones it already has listed (one listing per
 * (seller, mint) pair). Listings by other sellers never exclude an
 * inscription. No candidates without a connected wallet.
 */
export function sellCandidates(
  owned: WalletInscription[],
  listings: Listing[],
  seller: string | null,
): SellCandidate[] {
  if (seller === null) {
    return [];
  }
  const listedMints = new Set(
    listings
      .filter((listing) => listing.seller.toBase58() === seller)
      .map((listing) => listing.mint.toBase58()),
  );
  return owned
    .filter((inscription) => !listedMints.has(inscription.mint))
    .map((inscription) => ({
      mint: inscription.mint,
      label: `${inscription.tick} · ${shortenAddress(inscription.mint)}`,
    }));
}
