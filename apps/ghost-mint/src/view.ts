import type { MintCost, MintLimits } from "@skelsol/template";
import { formatLamports, shortenAddress } from "@skelsol/template";

/**
 * Pure view logic for Ghost Mint: the display strings the page shows
 * that belong to this app alone. The shared display helpers
 * (`formatCount`, `statsViewModel`, `activityLabel`, `timeAgo`) live
 * in the template's UI kit (`@skelsol/template`) and are imported
 * from there by `main.ts` and the tests. No DOM here, so every
 * function is unit-tested; `main.ts` owns the DOM and calls these.
 */

/**
 * The mint section's allowance line for the connected wallet. Without
 * a wallet, it asks to connect; when minting is refused, it shows the
 * plain-words reason from the limits check. The count is mints, not
 * holdings: the reader attributes inscriptions to the wallet that
 * minted them and never observes transfers.
 */
export function mintAllowanceText(limits: MintLimits | null): string {
  if (limits === null) {
    return "Connect Phantom or Solflare to see your allowance.";
  }
  if (!limits.canMint) {
    return limits.reason ?? "You cannot mint right now.";
  }
  const left = limits.perWalletLimit - limits.mintedByWallet;
  return `You minted ${limits.mintedByWallet} of ${limits.perWalletLimit} · ${left} left.`;
}

/**
 * The warning banner shown while the app is on mainnet: real money,
 * and the demo collection lives on devnet. Shown by
 * `updateNetworkGuard` in `main.ts`.
 */
export function mainnetWarningText(): string {
  return (
    "You are on mainnet: transactions here use real SOL. " +
    "This demo collection (GHOST) lives on devnet — minting is " +
    "disabled here. Switch back to devnet to try the demo for free."
  );
}

/** The mint section's allowance line while the app is on mainnet. */
export function mainnetMintDisabledText(): string {
  return "Minting is disabled on mainnet. Switch back to devnet to mint.";
}

/** The mint cost breakdown, as display strings. */
export interface CostLines {
  rent: string;
  price: string;
  /** The estimated network fee (signature fees), its own line so the total adds up. */
  fee: string;
  total: string;
}

/** Format a mint cost breakdown in SOL. */
export function formatCostLines(cost: MintCost): CostLines {
  return {
    rent: formatLamports(cost.rentLamports),
    price: formatLamports(cost.priceLamports),
    fee: formatLamports(cost.networkFeeLamports),
    total: formatLamports(cost.totalLamports),
  };
}

/**
 * One line summarising a wallet lookup result. "Minted", not "holds":
 * the reader attributes inscriptions to the wallet that minted them
 * and never observes transfers, so it cannot say what a wallet holds
 * now.
 */
export function lookupSummary(
  tick: string,
  wallet: string,
  count: number,
): string {
  const noun = count === 1 ? "inscription" : "inscriptions";
  return `Wallet ${shortenAddress(wallet)} minted ${count} ${tick} ${noun}.`;
}
