import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  activityLabel,
  feeSplit,
  formatCount,
  timeAgo,
  type ActivityEvent,
  type CollectionState,
  type Listing,
  type WalletInscription,
} from "@skelsol/template";

import {
  emptyListingsText,
  floorPrice,
  listingRow,
  mainnetTradingDisabledText,
  mainnetWarningText,
  marketUnavailableText,
  parseSolPrice,
  salePreview,
  sellCandidates,
  sortListings,
  statsViewModel,
} from "./view.js";

const ALICE = "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg";
const BOB = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const MINT_ALICE_1 = "2X1DLFAj9WLZXbyykDryC9bLuXRyBwM4dNrpTPFBafA2";
const MINT_ALICE_2 = "8SFqwqnq4whPhs8icwHA2hQg3hUoN1qrCLK1SBx3WKwe";
const MINT_BOB_1 = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const LISTING_ALICE_1 = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";

const STATE: CollectionState = {
  tick: "GHOST",
  supply: 4444,
  minted: 12,
  remaining: 4432,
  holders: 5,
  malformedMemos: 0,
  unverifiedInscriptions: 0,
};

function listing(
  address: string,
  seller: string,
  mint: string,
  price: bigint,
): Listing {
  return {
    address: new PublicKey(address),
    seller: new PublicKey(seller),
    mint: new PublicKey(mint),
    price,
    bump: 255,
  };
}

const LISTING_CHEAP = listing(
  LISTING_ALICE_1,
  ALICE,
  MINT_ALICE_1,
  500_000_000n,
);
const LISTING_DEAR = listing(
  "JCUvbG1XAjXE1RWDyp7gwMV5AHjz719Tbhv9gW3uD3z3",
  BOB,
  MINT_BOB_1,
  2_000_000_000n,
);

describe("parseSolPrice", () => {
  it("parses whole SOL amounts to lamports", () => {
    expect(parseSolPrice("1")).toEqual({ ok: true, lamports: 1_000_000_000n });
    expect(parseSolPrice("2")).toEqual({ ok: true, lamports: 2_000_000_000n });
  });

  it("parses fractional SOL amounts without floating-point rounding", () => {
    expect(parseSolPrice("0.5")).toEqual({
      ok: true,
      lamports: 500_000_000n,
    });
    expect(parseSolPrice("0.000000001")).toEqual({
      ok: true,
      lamports: 1n,
    });
    // 0.1 + 0.2 territory: a float parse would not land on 300,000,000.
    expect(parseSolPrice("0.3")).toEqual({
      ok: true,
      lamports: 300_000_000n,
    });
  });

  it("accepts a leading decimal point and surrounding whitespace", () => {
    expect(parseSolPrice(".5")).toEqual({
      ok: true,
      lamports: 500_000_000n,
    });
    expect(parseSolPrice("  1.5  ")).toEqual({
      ok: true,
      lamports: 1_500_000_000n,
    });
  });

  it("accepts a zero price", () => {
    expect(parseSolPrice("0")).toEqual({ ok: true, lamports: 0n });
  });

  it("rejects an empty price", () => {
    expect(parseSolPrice("")).toEqual({
      ok: false,
      error: "Enter a price in SOL.",
    });
    expect(parseSolPrice("   ")).toEqual({
      ok: false,
      error: "Enter a price in SOL.",
    });
  });

  it("rejects non-numeric input", () => {
    expect(parseSolPrice("free")).toEqual({
      ok: false,
      error: "Enter a price in SOL, like 0.5 or 2.",
    });
    expect(parseSolPrice("1.2.3")).toEqual({
      ok: false,
      error: "Enter a price in SOL, like 0.5 or 2.",
    });
    expect(parseSolPrice("-1")).toEqual({
      ok: false,
      error: "Enter a price in SOL, like 0.5 or 2.",
    });
  });

  it("rejects more than 9 decimal places", () => {
    expect(parseSolPrice("0.0000000001")).toEqual({
      ok: false,
      error:
        "A price can have at most 9 decimal places: 1 lamport is 0.000000001 SOL.",
    });
  });

  it("rejects a price larger than the u64 maximum", () => {
    expect(parseSolPrice("18446744074")).toEqual({
      ok: false,
      error:
        "That price is too large: the largest price is 18,446,744,073.709551615 SOL.",
    });
  });
});

describe("feeSplit", () => {
  it("splits 1% to the fee and 99% to the seller", () => {
    expect(feeSplit(1_000_000_000n)).toEqual({
      fee: 10_000_000n,
      sellerAmount: 990_000_000n,
    });
  });

  it("rounds the fee down, so the remainder goes to the seller", () => {
    // The worked example from docs/DEPLOY.md.
    expect(feeSplit(1_000_001n)).toEqual({
      fee: 10_000n,
      sellerAmount: 990_001n,
    });
  });

  it("charges no fee on a price under 100 lamports", () => {
    expect(feeSplit(99n)).toEqual({ fee: 0n, sellerAmount: 99n });
  });
});

describe("salePreview", () => {
  it("shows the total, the fee, and what the seller receives", () => {
    expect(salePreview(1_000_000_000n)).toEqual({
      total: "1 SOL",
      fee: "0.01 SOL",
      sellerReceives: "0.99 SOL",
    });
  });
});

describe("listingRow", () => {
  it("maps a listing to display strings", () => {
    expect(listingRow(LISTING_CHEAP, null)).toEqual({
      seller: "BYMf…dgXg",
      sellerAddress: ALICE,
      mint: "2X1D…afA2",
      mintAddress: MINT_ALICE_1,
      amount: "1",
      price: "0.5 SOL",
      total: "0.5 SOL",
      isOwn: false,
    });
  });

  it("marks a listing as the connected wallet's own", () => {
    expect(listingRow(LISTING_CHEAP, ALICE).isOwn).toBe(true);
    expect(listingRow(LISTING_CHEAP, BOB).isOwn).toBe(false);
  });
});

describe("sortListings", () => {
  it("orders cheapest first, ties by mint address", () => {
    expect(sortListings([LISTING_DEAR, LISTING_CHEAP])).toEqual([
      LISTING_CHEAP,
      LISTING_DEAR,
    ]);
    const samePrice = listing(
      LISTING_ALICE_1,
      BOB,
      MINT_BOB_1,
      500_000_000n,
    );
    expect(sortListings([samePrice, LISTING_CHEAP])).toEqual([
      LISTING_CHEAP,
      samePrice,
    ]);
  });

  it("does not mutate the input", () => {
    const input = [LISTING_DEAR, LISTING_CHEAP];
    sortListings(input);
    expect(input).toEqual([LISTING_DEAR, LISTING_CHEAP]);
  });
});

describe("floorPrice", () => {
  it("returns the lowest price, or null when there are no listings", () => {
    expect(floorPrice([LISTING_DEAR, LISTING_CHEAP])).toBe(500_000_000n);
    expect(floorPrice([])).toBe(null);
  });
});

describe("statsViewModel", () => {
  it("maps collection state and listings to the stats row", () => {
    expect(
      statsViewModel(STATE, "deployed", [LISTING_DEAR, LISTING_CHEAP]),
    ).toEqual({
      minted: "12 / 4,444",
      minters: "5",
      inscriptions: "12",
      listings: "2",
      floor: "0.5 SOL",
    });
  });

  it("shows 0 listings and a dash floor when the program is deployed but empty", () => {
    expect(statsViewModel(STATE, "deployed", [])).toEqual({
      minted: "12 / 4,444",
      minters: "5",
      inscriptions: "12",
      listings: "0",
      floor: "—",
    });
  });

  it("shows dashes, not zeroes, when the program is not deployed", () => {
    expect(statsViewModel(STATE, "not-deployed", [])).toEqual({
      minted: "12 / 4,444",
      minters: "5",
      inscriptions: "12",
      listings: "—",
      floor: "—",
    });
  });
});

describe("marketUnavailableText", () => {
  it("names the network the program is missing from", () => {
    expect(marketUnavailableText("devnet")).toBe(
      "The market program is not deployed on devnet yet, so there are no " +
        "listings to show. Listing, buying, and cancelling will work once " +
        "the program is deployed.",
    );
    expect(marketUnavailableText("mainnet")).toContain("mainnet");
  });
});

describe("mainnetWarningText", () => {
  it("warns that mainnet uses real money and the demo lives on devnet", () => {
    expect(mainnetWarningText()).toBe(
      "You are on mainnet: transactions here use real SOL. " +
        "This demo collection (GHOST) lives on devnet — listing, buying, " +
        "and cancelling are disabled here. Switch back to devnet to try " +
        "the demo for free.",
    );
  });
});

describe("mainnetTradingDisabledText", () => {
  it("says listing, buying, and cancelling are disabled on mainnet", () => {
    expect(mainnetTradingDisabledText()).toBe(
      "Listing, buying, and cancelling are disabled on mainnet. " +
        "Switch back to devnet to trade.",
    );
  });
});

describe("emptyListingsText", () => {
  it("says the market is open but empty", () => {
    expect(emptyListingsText()).toBe(
      "No listings yet. List a carrier NFT below to open the first one.",
    );
  });
});

describe("sellCandidates", () => {
  const owned: WalletInscription[] = [
    {
      mint: MINT_ALICE_1,
      tick: "GHOST",
      signature: "sig-1",
      blockTime: 1_700_000_000,
      slot: 1,
    },
    {
      mint: MINT_ALICE_2,
      tick: "GHOST",
      signature: "sig-2",
      blockTime: 1_700_000_001,
      slot: 2,
    },
  ];

  it("lists every owned inscription when nothing is listed", () => {
    expect(sellCandidates(owned, [], ALICE)).toEqual([
      { mint: MINT_ALICE_1, label: "GHOST · 2X1D…afA2" },
      { mint: MINT_ALICE_2, label: "GHOST · 8SFq…WKwe" },
    ]);
  });

  it("excludes inscriptions the seller already has listed", () => {
    expect(sellCandidates(owned, [LISTING_CHEAP], ALICE)).toEqual([
      { mint: MINT_ALICE_2, label: "GHOST · 8SFq…WKwe" },
    ]);
  });

  it("does not exclude inscriptions listed by someone else", () => {
    expect(sellCandidates(owned, [LISTING_DEAR], ALICE)).toEqual([
      { mint: MINT_ALICE_1, label: "GHOST · 2X1D…afA2" },
      { mint: MINT_ALICE_2, label: "GHOST · 8SFq…WKwe" },
    ]);
  });

  it("returns no candidates without a connected wallet", () => {
    expect(sellCandidates(owned, [], null)).toEqual([]);
  });
});

describe("formatCount", () => {
  it("formats small counts plainly and large ones with separators", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12)).toBe("12");
    expect(formatCount(4444)).toBe("4,444");
  });
});

describe("activityLabel", () => {
  it("labels a listing event with shortened wallet and mint", () => {
    const event: ActivityEvent = {
      type: "listing",
      signature: "sig",
      wallet: ALICE,
      mint: MINT_ALICE_1,
      tick: "GHOST",
      blockTime: 1_700_000_000,
      slot: 1,
    };
    expect(activityLabel(event)).toBe(
      "Listing · BYMf…dgXg listed 2X1D…afA2",
    );
  });

  it("labels a buy event with shortened wallet and mint", () => {
    const event: ActivityEvent = {
      type: "buy",
      signature: "sig",
      wallet: BOB,
      mint: MINT_BOB_1,
      tick: "GHOST",
      blockTime: 1_700_000_000,
      slot: 1,
    };
    expect(activityLabel(event)).toBe("Buy · Edmx…EEh1 bought AKkz…PnNa");
  });
});

describe("timeAgo", () => {
  it("says just now for the last minute", () => {
    expect(timeAgo(1_700_000_000, 1_700_000_030)).toBe("just now");
  });

  it("counts minutes, hours, and days", () => {
    expect(timeAgo(1_700_000_000, 1_700_000_000 + 5 * 60)).toBe("5m ago");
    expect(timeAgo(1_700_000_000, 1_700_000_000 + 3 * 3600)).toBe("3h ago");
    expect(timeAgo(1_700_000_000, 1_700_000_000 + 2 * 86400)).toBe("2d ago");
  });

  it("says unknown time when the block time is missing", () => {
    expect(timeAgo(null, 1_700_000_000)).toBe("unknown time");
  });
});
