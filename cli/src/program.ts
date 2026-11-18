import {
  checkMarketDeployed,
  getEscrowProgramId,
  NETWORK_UNREACHABLE_MESSAGE,
  type MarketConnection,
  type Network,
} from "@skelsol/template";

import { CliError } from "./args.js";

/**
 * The market-program deployed check. The escrow program is built and
 * tested but not yet deployed to devnet (funding pending, see
 * docs/DEPLOY.md), and never deployed to mainnet. Market commands must
 * refuse with a clear message while the program is missing: never a
 * stack trace, never a faked result.
 */

/**
 * The plain-words message every market command shows while the program
 * is not deployed on the network.
 */
export function marketNotDeployedMessage(network: Network): string {
  return (
    `The market program is not deployed on ${network} yet. The market ` +
    `(list, buy, cancel, floor price) is unavailable until the program ` +
    `deploys. Minting still works. See docs/DEPLOY.md for the deploy status.`
  );
}

/** The market program is not deployed on this network yet. */
export class ProgramNotDeployedError extends Error {
  constructor(network: Network) {
    super(marketNotDeployedMessage(network));
    this.name = "ProgramNotDeployedError";
  }
}

/**
 * Whether the escrow program account exists on the network. Returns
 * false while the program has no ID on the network (mainnet) or while
 * the account is missing (devnet deploy pending). The check itself
 * lives in the template (`checkMarketDeployed`); this wrapper only
 * turns its propagated RPC failure into the CLI's plain-words
 * {@link CliError}, never a false negative.
 */
export async function isMarketProgramDeployed(
  connection: MarketConnection,
  network: Network,
): Promise<boolean> {
  try {
    return await checkMarketDeployed(connection, network);
  } catch (error) {
    throw new CliError(NETWORK_UNREACHABLE_MESSAGE, { cause: error });
  }
}

/**
 * Return the escrow program ID when the program is deployed, or throw
 * a {@link ProgramNotDeployedError} with the plain-words message when
 * it is not.
 */
export async function assertMarketProgramDeployed(
  connection: MarketConnection,
  network: Network,
): Promise<string> {
  const deployed = await isMarketProgramDeployed(connection, network);
  if (!deployed) {
    throw new ProgramNotDeployedError(network);
  }
  return getEscrowProgramId(network);
}
