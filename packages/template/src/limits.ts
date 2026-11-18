import type { PublicKey } from "@solana/web3.js";

import type { CollectionConfig } from "./config.js";
import type { MintLimitsChecker } from "./mint.js";
import {
  getMintLimits,
  type MintLimits,
  type ReaderConnection,
} from "./reader.js";

/**
 * Wire the template reader into the mint client's limit check: the
 * checker calls `getMintLimits` with the wallet's address and returns
 * its result. The shapes already match, because `MintLimits` is the
 * reader's type. The Ghost Mint app and the `skel` CLI both use this
 * one wiring instead of each carrying its own copy.
 */
export function createReaderLimitsChecker(
  connection: ReaderConnection,
): MintLimitsChecker {
  return {
    checkMintLimits(
      collection: CollectionConfig,
      wallet: PublicKey,
    ): Promise<MintLimits> {
      return getMintLimits(connection, collection, wallet.toBase58());
    },
  };
}
