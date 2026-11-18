import { describe, expect, it } from "vitest";

import {
  explorerAddressUrl,
  explorerTransactionUrl,
  formatLamports,
  formatLamportsBigint,
  shortenAddress,
} from "./ui.js";

describe("formatLamports", () => {
  it("formats zero lamports as 0 SOL", () => {
    expect(formatLamports(0)).toBe("0 SOL");
  });

  it("formats exactly one SOL without a decimal point", () => {
    expect(formatLamports(1_000_000_000)).toBe("1 SOL");
  });

  it("formats a fractional amount, trimming trailing zeroes", () => {
    expect(formatLamports(1_500_000_000)).toBe("1.5 SOL");
    expect(formatLamports(2_500_000)).toBe("0.0025 SOL");
  });

  it("formats a single lamport at full precision", () => {
    expect(formatLamports(1)).toBe("0.000000001 SOL");
  });

  it("formats a whole multi-SOL amount with thousands separators", () => {
    expect(formatLamports(4444_000_000_000)).toBe("4,444 SOL");
  });

  it("keeps the minus sign on a negative sub-1-SOL amount", () => {
    // -0.5 SOL: the whole part truncates to -0, which must not eat the sign.
    expect(formatLamports(-500_000_000)).toBe("-0.5 SOL");
    expect(formatLamports(-1_500_000_000)).toBe("-1.5 SOL");
    expect(formatLamports(-1)).toBe("-0.000000001 SOL");
  });
});

describe("formatLamportsBigint", () => {
  it("formats zero lamports as 0 SOL", () => {
    expect(formatLamportsBigint(0n)).toBe("0 SOL");
  });

  it("formats exactly one SOL without a decimal point", () => {
    expect(formatLamportsBigint(1_000_000_000n)).toBe("1 SOL");
  });

  it("formats a fractional amount, trimming trailing zeroes", () => {
    expect(formatLamportsBigint(1_500_000_000n)).toBe("1.5 SOL");
    expect(formatLamportsBigint(2_500_000n)).toBe("0.0025 SOL");
    expect(formatLamportsBigint(1_000_000_001n)).toBe("1.000000001 SOL");
  });

  it("formats a single lamport at full precision", () => {
    expect(formatLamportsBigint(1n)).toBe("0.000000001 SOL");
  });

  it("formats a whole multi-SOL amount with thousands separators", () => {
    expect(formatLamportsBigint(4444_000_000_000n)).toBe("4,444 SOL");
  });

  it("stays exact past Number.MAX_SAFE_INTEGER, where the number version cannot", () => {
    // 9,007,199,254,740,993 is 2^53 + 1: not representable as a number.
    expect(formatLamportsBigint(9_007_199_254_740_993n)).toBe(
      "9,007,199.254740993 SOL",
    );
  });

  it("formats the largest u64 price exactly", () => {
    expect(formatLamportsBigint(18_446_744_073_709_551_615n)).toBe(
      "18,446,744,073.709551615 SOL",
    );
  });
});

describe("shortenAddress", () => {
  it("shortens a wallet address to its first and last four characters", () => {
    expect(
      shortenAddress("BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg"),
    ).toBe("BYMf…dgXg");
  });

  it("leaves a short address untouched", () => {
    expect(shortenAddress("abc123")).toBe("abc123");
  });

  it("uses the requested number of edge characters", () => {
    expect(
      shortenAddress("BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg", 6),
    ).toBe("BYMfsB…v2dgXg");
  });
});

describe("explorerTransactionUrl", () => {
  it("points at the devnet cluster for devnet", () => {
    expect(explorerTransactionUrl("5abcSig", "devnet")).toBe(
      "https://explorer.solana.com/tx/5abcSig?cluster=devnet",
    );
  });

  it("points at the default (mainnet) cluster for mainnet", () => {
    expect(explorerTransactionUrl("5abcSig", "mainnet")).toBe(
      "https://explorer.solana.com/tx/5abcSig",
    );
  });
});

describe("explorerAddressUrl", () => {
  it("points at the devnet cluster for devnet", () => {
    expect(
      explorerAddressUrl(
        "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
        "devnet",
      ),
    ).toBe(
      "https://explorer.solana.com/address/BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg?cluster=devnet",
    );
  });

  it("points at the default (mainnet) cluster for mainnet", () => {
    expect(
      explorerAddressUrl(
        "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
        "mainnet",
      ),
    ).toBe(
      "https://explorer.solana.com/address/BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg",
    );
  });
});
