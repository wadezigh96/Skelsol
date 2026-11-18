import { describe, expect, it } from "vitest";

import { PublicKey } from "@solana/web3.js";

import { GHOST_COLLECTION } from "./config.js";
import { createReaderLimitsChecker } from "./limits.js";
import type {
  ReaderConnection,
  ReaderSignatureInfo,
  ReaderTransaction,
} from "./reader.js";

const ALICE = "BYMfsBn8RhCsJMFQ7fZcyu5yUCfjgHV9bMWhWLv2dgXg";
const MINT_ALICE_1 = "2X1DLFAj9WLZXbyykDryC9bLuXRyBwM4dNrpTPFBafA2";
const SIG_ALICE_1 = "sig-alice-1";

/** A ReaderConnection fake backed by hand-built transactions. */
class FakeReaderConnection implements ReaderConnection {
  constructor(private readonly transactions: ReaderTransaction[]) {}

  async getSignaturesForAddress(): Promise<ReaderSignatureInfo[]> {
    return this.transactions.map((tx) => ({
      signature: tx.transaction.signatures[0] as string,
      slot: tx.slot,
      err: null,
      blockTime: tx.blockTime ?? null,
    }));
  }

  async getTransaction(
    signature: string,
  ): Promise<ReaderTransaction | null> {
    return (
      this.transactions.find(
        (tx) => tx.transaction.signatures[0] === signature,
      ) ?? null
    );
  }
}

/** One verified mint transaction: a memo inscription plus its carrier NFT. */
function mintTransaction(
  signature: string,
  holder: string,
  mint: string,
): ReaderTransaction {
  const inscriptionJson = JSON.stringify({
    p: "spl-20",
    op: "mint",
    tick: "GHOST",
    amt: "1",
    mint,
  });
  return {
    slot: 1,
    blockTime: 1_700_000_000,
    meta: {
      err: null,
      logMessages: [
        `Program log: Memo (len ${inscriptionJson.length}): ${JSON.stringify(inscriptionJson)}`,
      ],
      preTokenBalances: [],
      postTokenBalances: [
        { mint, owner: holder, uiTokenAmount: { amount: "1" } },
      ],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [
          { pubkey: new PublicKey(holder), signer: true, writable: true },
        ],
      },
    },
  };
}

describe("createReaderLimitsChecker", () => {
  it("reports an empty collection as mintable", async () => {
    const checker = createReaderLimitsChecker(new FakeReaderConnection([]));

    const limits = await checker.checkMintLimits(
      GHOST_COLLECTION,
      new PublicKey(ALICE),
    );

    expect(limits).toEqual({
      tick: "GHOST",
      minted: 0,
      supply: 4444,
      remaining: 4444,
      mintedByWallet: 0,
      perWalletLimit: 4,
      canMint: true,
      reason: null,
    });
  });

  it("counts the connected wallet's own mints", async () => {
    const checker = createReaderLimitsChecker(
      new FakeReaderConnection([
        mintTransaction(SIG_ALICE_1, ALICE, MINT_ALICE_1),
      ]),
    );

    const limits = await checker.checkMintLimits(
      GHOST_COLLECTION,
      new PublicKey(ALICE),
    );

    expect(limits.minted).toBe(1);
    expect(limits.mintedByWallet).toBe(1);
    expect(limits.canMint).toBe(true);
  });
});
