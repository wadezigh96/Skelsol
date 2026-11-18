import type { Network } from "@skelsol/template";

/**
 * Argument parsing for `skel`: the command, the flags, and the help
 * text. Pure functions, no I/O, so the tests run offline.
 *
 * Shape of a call:
 *
 *   skel [--network devnet|mainnet] [--json] [--keypair <path>] <command> [args]
 *
 * Flags may come before or after the command. There is deliberately no
 * `--yes` flag: every write shows a preview and sends only after the
 * user types an explicit yes (see ADR 0007).
 */

/** A clear, typed refusal to run: bad command, bad flag, bad arguments. */
export class CliError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CliError";
  }
}

/** The commands `skel` provides. See GLOSSARY.md: skel. */
export type CommandName =
  | "status"
  | "mint"
  | "list"
  | "buy"
  | "cancel"
  | "lookup";

const COMMANDS: readonly CommandName[] = [
  "status",
  "mint",
  "list",
  "buy",
  "cancel",
  "lookup",
];

function isCommandName(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

/** What a parsed `skel` invocation carries. */
export interface ParsedArgs {
  command: CommandName;
  network: Network;
  json: boolean;
  keypairPath: string | null;
  /** Positional arguments after the command (mint, seller, wallet). */
  args: string[];
  /**
   * The list price in lamports, parsed from the `list` command's second
   * argument. Only set for `list`.
   */
  priceLamports?: bigint;
}

/** A request for help instead of a command run. */
export interface HelpRequest {
  help: true;
  /** The command to show help for, or null for the general help. */
  command: CommandName | null;
}

export function isHelpRequest(
  parsed: ParsedArgs | HelpRequest,
): parsed is HelpRequest {
  return (parsed as HelpRequest).help === true;
}

/**
 * What each command takes: how many positional arguments, and what
 * they are in plain words (used by the arity errors). One map, so the
 * count and the description can never drift apart.
 */
const COMMAND_SPECS: Record<
  CommandName,
  { arity: number; description: string }
> = {
  status: { arity: 0, description: "takes no arguments" },
  mint: { arity: 0, description: "takes no arguments" },
  list: {
    arity: 2,
    description: "takes a mint address and a price in lamports",
  },
  buy: { arity: 2, description: "takes a seller address and a mint address" },
  cancel: { arity: 1, description: "takes a mint address" },
  lookup: { arity: 1, description: "takes a wallet address" },
};

/** A list price is a whole number of lamports: digits only, no sign, no decimals. */
const PRICE_PATTERN = /^[0-9]+$/;

function parsePriceLamports(raw: string): bigint {
  if (!PRICE_PATTERN.test(raw)) {
    throw new CliError(
      `Invalid price "${raw}": the price must be a whole number of ` +
        `lamports (for example 1000000000 for 1 SOL).`,
    );
  }
  return BigInt(raw);
}

/**
 * Parse `process.argv.slice(2)` into a command or a help request.
 * Throws a {@link CliError} with a plain-words message for an unknown
 * command or flag, a missing value, or the wrong number of arguments.
 */
export function parseArgs(argv: string[]): ParsedArgs | HelpRequest {
  let command: CommandName | null = null;
  let network: Network = "devnet";
  let json = false;
  let keypairPath: string | null = null;
  const args: string[] = [];

  let index = 0;
  while (index < argv.length) {
    const token = argv[index] as string;
    index += 1;

    if (token === "--help" || token === "-h") {
      return { help: true, command };
    }
    if (token === "help" && command === null && args.length === 0) {
      const next = argv[index];
      if (next === undefined) {
        return { help: true, command: null };
      }
      if (!isCommandName(next)) {
        throw new CliError(
          `Unknown command "${next}". Run "skel --help" to see the commands.`,
        );
      }
      return { help: true, command: next };
    }

    const equalsAt = token.indexOf("=");
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt);
    const inlineValue =
      equalsAt === -1 ? undefined : token.slice(equalsAt + 1);

    const flagValue = (name: string): string => {
      if (inlineValue !== undefined) {
        if (inlineValue.length === 0) {
          throw new CliError(
            `${name} needs a value: ${name} devnet, for example.`,
          );
        }
        return inlineValue;
      }
      const value = argv[index];
      if (value === undefined) {
        throw new CliError(
          `${name} needs a value: ${name} devnet, for example.`,
        );
      }
      index += 1;
      return value;
    };

    if (flag === "--network") {
      const value = flagValue("--network");
      if (value !== "devnet" && value !== "mainnet") {
        throw new CliError(
          `Unknown network "${value}". Supported networks: devnet, mainnet.`,
        );
      }
      network = value;
      continue;
    }
    if (flag === "--json") {
      if (inlineValue !== undefined) {
        throw new CliError(
          `--json takes no value. Pass "--json" on its own.`,
        );
      }
      json = true;
      continue;
    }
    if (flag === "--keypair") {
      keypairPath = flagValue("--keypair");
      continue;
    }
    // A dash token is a flag, except a negative number ("-5"), which is
    // a positional value (so a negative list price is rejected as a bad
    // price, not as an unknown flag).
    if (token.startsWith("-") && !/^-\d/.test(token)) {
      throw new CliError(
        `Unknown flag "${flag}". Run "skel --help" to see the flags.`,
      );
    }

    if (command === null) {
      if (!isCommandName(token)) {
        throw new CliError(
          `Unknown command "${token}". Run "skel --help" to see the commands.`,
        );
      }
      command = token;
      continue;
    }
    if (isCommandName(token)) {
      throw new CliError(
        `Unexpected argument "${token}": only one command per call. ` +
          `Run "skel --help" to see the commands.`,
      );
    }
    args.push(token);
  }

  if (command === null) {
    throw new CliError(
      "No command given. Run \"skel --help\" to see the commands.",
    );
  }
  const spec = COMMAND_SPECS[command];
  if (args.length !== spec.arity) {
    throw new CliError(
      `Wrong number of arguments: "${command}" ${spec.description}, ` +
        `but got ${args.length}. Run "skel help ${command}" for usage.`,
    );
  }

  const parsed: ParsedArgs = { command, network, json, keypairPath, args };
  if (command === "list") {
    parsed.priceLamports = parsePriceLamports(args[1] as string);
  }
  return parsed;
}

const KEYPAIR_WARNING = [
  "Keypair safety:",
  "  Never commit a keypair file to a repo, and never use a keypair holding large funds.",
  "  Use a dedicated low-value agent wallet: fund it with only what the",
  "  agent needs, and keep the file out of git.",
].join("\n");

const SAFETY_RULE = [
  "Safety rule:",
  "  Every write (mint, list, buy, cancel) shows a transaction preview",
  "  first and sends only after you confirm that exact action by typing",
  "  an explicit yes. There is no --yes flag. Never batch-approve.",
].join("\n");

const COMMAND_HELP: Record<CommandName, string> = {
  status: [
    "Usage: skel status [--network devnet|mainnet] [--json]",
    "",
    "Show the GHOST collection state: minted, remaining, minters, and",
    "the market floor price. Read-only: needs no keypair.",
    "",
    "Example:",
    "  skel status",
    "  skel status --json",
  ].join("\n"),
  mint: [
    "Usage: skel mint --keypair <path> [--network devnet|mainnet] [--json]",
    "",
    "Mint one GHOST inscription (plus its carrier NFT) to the keypair",
    "wallet. Shows a preview with the exact cost, then asks for",
    "confirmation before sending.",
    "",
    "Example:",
    "  skel mint --keypair ./agent-keypair.json",
  ].join("\n"),
  list: [
    "Usage: skel list <mint> <price-lamports> --keypair <path> [--network devnet|mainnet] [--json]",
    "",
    "List a carrier NFT for sale at a fixed price. <mint> is the carrier",
    "NFT's mint address; <price-lamports> is the price in lamports as a",
    "whole number (1 SOL = 1000000000 lamports). The NFT moves into",
    "escrow until it is bought or the listing is cancelled.",
    "",
    "Example:",
    "  skel list <mint> 1000000000 --keypair ./agent-keypair.json",
  ].join("\n"),
  buy: [
    "Usage: skel buy <seller> <mint> --keypair <path> [--network devnet|mainnet] [--json]",
    "",
    "Buy a listed inscription. <seller> is the seller's wallet address;",
    "<mint> is the carrier NFT's mint address. The listing is re-read",
    "before buying, so a listing that is already gone is refused. The",
    "price charged is always the price stored in the listing, never",
    "client input: 99% goes to the seller, 1% to the treasury.",
    "",
    "Example:",
    "  skel buy <seller> <mint> --keypair ./agent-keypair.json",
  ].join("\n"),
  cancel: [
    "Usage: skel cancel <mint> --keypair <path> [--network devnet|mainnet] [--json]",
    "",
    "Cancel your listing for a carrier NFT. Only the seller can cancel.",
    "The NFT returns to your wallet and the listing closes.",
    "",
    "Example:",
    "  skel cancel <mint> --keypair ./agent-keypair.json",
  ].join("\n"),
  lookup: [
    "Usage: skel lookup <wallet> [--network devnet|mainnet] [--json]",
    "",
    "List one wallet's GHOST inscriptions, newest first. Read-only:",
    "needs no keypair.",
    "",
    "Example:",
    "  skel lookup <wallet>",
  ].join("\n"),
};

/**
 * The help text: general help when `command` is null, per-command help
 * otherwise. Both carry the keypair warning and the safety rule.
 */
export function helpText(command: CommandName | null): string {
  if (command !== null) {
    return [
      `skel ${command}`,
      "",
      COMMAND_HELP[command],
      "",
      KEYPAIR_WARNING,
      "",
      SAFETY_RULE,
      "",
    ].join("\n");
  }
  return [
    "skel: use Skelsol from a terminal.",
    "",
    "Usage: skel [--network devnet|mainnet] [--json] [--keypair <path>] <command> [args]",
    "",
    "Commands:",
    "  status                 Collection state + floor price (no keypair needed)",
    "  mint                   Mint one GHOST inscription + carrier NFT",
    "  list <mint> <price>    List a carrier NFT at a fixed price in lamports",
    "  buy <seller> <mint>    Buy a listed inscription",
    "  cancel <mint>          Cancel your listing for a carrier NFT",
    "  lookup <wallet>        List one wallet's GHOST inscriptions (no keypair needed)",
    "",
    "Flags:",
    "  --network devnet|mainnet   Network to use (default: devnet)",
    "  --json                     Machine-readable output: JSON only on stdout",
    "  --keypair <path>           Local keypair file for writes (mint, list, buy, cancel)",
    "  --help, -h                 Show this help, or help for one command",
    "",
    "Examples:",
    "  skel status",
    "  skel lookup <wallet> --json",
    "  skel mint --keypair ./agent-keypair.json",
    "  skel list <mint> 1000000000 --keypair ./agent-keypair.json",
    "",
    KEYPAIR_WARNING,
    "",
    SAFETY_RULE,
    "",
    "Full manual: agent.md at the repo root.",
    "",
  ].join("\n");
}
