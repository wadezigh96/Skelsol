import { describe, expect, it } from "vitest";

import {
  activityLabel,
  formatCount,
  statsViewModel,
  timeAgo,
  type ActivityEvent,
  type CollectionState,
  type MintCost,
  type MintLimits,
} from "@skelsol/template";

import {
  formatCostLines,
  lookupSummary,
  mainnetMintDisabledText,
  mainnetWarningText,
  mintAllowanceText,
} from "./view.js";

const STATE: CollectionState = {
  tick: "GHOST",
  supply: 4444,
  minted: 12,
  remaining: 4432,
  holders: 5,
  malformedMemos: 0,
  unverifiedInscriptions: 0,
};

const LIMITS: MintLimits = {
  tick: "GHOST",
  minted: 12,
  supply: 4444,
  remaining: 4432,
  mintedByWallet: 1,
  perWalletLimit: 4,
  canMint: true,
  reason: null,
};

const COST: MintCost = {
  carrierRentLamports: 2_000_000,
  tokenAccountRentLamports: 2_039_280,
  rentLamports: 4_039_280,
  priceLamports: 0,
  networkFeeLamports: 10_000,
  totalLamports: 4_049_280,
  bytesCreatedOnChain: 1000,
};

describe("formatCount", () => {
  it("formats small counts plainly and large ones with separators", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12)).toBe("12");
    expect(formatCount(4444)).toBe("4,444");
  });
});

describe("statsViewModel", () => {
  it("maps collection state to the stats row", () => {
    expect(statsViewModel(STATE)).toEqual({
      minted: "12 / 4,444",
      minters: "5",
      inscriptions: "12",
      listings: "0",
      floor: "—",
    });
  });

  it("shows live market numbers when the market reports them", () => {
    expect(
      statsViewModel(STATE, { listings: 3, floorLamports: 500_000_000 }),
    ).toEqual({
      minted: "12 / 4,444",
      minters: "5",
      inscriptions: "12",
      listings: "3",
      floor: "0.5 SOL",
    });
  });

  it("shows a dash floor when there are no listings", () => {
    expect(statsViewModel(STATE, { listings: 0, floorLamports: null })).toEqual(
      {
        minted: "12 / 4,444",
        minters: "5",
        inscriptions: "12",
        listings: "0",
        floor: "—",
      },
    );
  });
});

describe("mintAllowanceText", () => {
  it("asks to connect when no wallet is connected", () => {
    expect(mintAllowanceText(null)).toBe(
      "Connect Phantom or Solflare to see your allowance.",
    );
  });

  it("shows minted count and remaining allowance when minting is allowed", () => {
    expect(mintAllowanceText(LIMITS)).toBe("You minted 1 of 4 · 3 left.");
  });

  it("shows the refusal reason when minting is not allowed", () => {
    expect(
      mintAllowanceText({
        ...LIMITS,
        mintedByWallet: 4,
        canMint: false,
        reason: "Per-wallet limit reached.",
      }),
    ).toBe("Per-wallet limit reached.");
  });
});

describe("mainnetWarningText", () => {
  it("warns that mainnet uses real money and the demo lives on devnet", () => {
    expect(mainnetWarningText()).toBe(
      "You are on mainnet: transactions here use real SOL. " +
        "This demo collection (GHOST) lives on devnet — minting is " +
        "disabled here. Switch back to devnet to try the demo for free.",
    );
  });
});

describe("mainnetMintDisabledText", () => {
  it("says minting is disabled on mainnet", () => {
    expect(mainnetMintDisabledText()).toBe(
      "Minting is disabled on mainnet. Switch back to devnet to mint.",
    );
  });
});

describe("formatCostLines", () => {
  it("formats the rent, price, fee, and total cost lines", () => {
    expect(formatCostLines(COST)).toEqual({
      rent: "0.00403928 SOL",
      price: "0 SOL",
      fee: "0.00001 SOL",
      total: "0.00404928 SOL",
    });
  });
});

describe("activityLabel", () => {
  it("labels a mint event with shortened wallet and mint", () => {
    const event: ActivityEvent = {
      type: "mint",
      signature: "sig",
      wallet: "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
      mint: "2X1DLFAj9WLZXbyykDryC9bLuXRyBwM4dNrpTPFBafA2",
      tick: "GHOST",
      blockTime: 1_700_000_000,
      slot: 1,
    };
    expect(activityLabel(event)).toBe(
      "Mint · BYMf…dgXg minted 2X1D…afA2",
    );
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

describe("lookupSummary", () => {
  it("summarises one wallet's mints", () => {
    expect(
      lookupSummary(
        "GHOST",
        "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
        2,
      ),
    ).toBe("Wallet BYMf…dgXg minted 2 GHOST inscriptions.");
  });

  it("uses the singular for one inscription", () => {
    expect(
      lookupSummary(
        "GHOST",
        "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
        1,
      ),
    ).toBe("Wallet BYMf…dgXg minted 1 GHOST inscription.");
  });
});
