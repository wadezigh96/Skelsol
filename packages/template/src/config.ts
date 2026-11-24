/**
 * Collection and network config for the Skelsol template.
 *
 * One collection config describes one inscription series (tick, name,
 * supply, per-wallet limit, price, image, metadata base URI). One network
 * config describes one Solana network (RPC endpoint, program IDs). Both
 * are validated at load, so a bad config fails fast with a clear error
 * instead of breaking a mint halfway through.
 */

import { PublicKey } from "@solana/web3.js";

import { TICK_PATTERN } from "./inscription.js";

/** One configured inscription series. See GLOSSARY.md: Collection. */
export interface CollectionConfig {
  /** Short ticker symbol, e.g. `GHOST`. */
  tick: string;
  /** Human-readable name, e.g. `Spooky Ghosts`. */
  name: string;
  /** Maximum number of inscriptions the collection can mint. */
  supply: number;
  /** Maximum number of inscriptions one wallet may mint. */
  perWalletLimit: number;
  /** Mint price in lamports. 0 means a free mint (rent only). */
  priceLamports: number;
  /**
   * The wallet that receives the mint price: the mint transaction pays
   * `priceLamports` to this address. Required when `priceLamports` is
   * above 0 (a priced mint with nowhere to send the price is a config
   * error); unused for a free mint.
   */
  treasury?: string;
  /** URL of the carrier NFT image. */
  image: string;
  /** Base URI the carrier NFT metadata URIs are built from. */
  metadataBaseUri: string;
  /**
   * Mint-transaction signatures the reader always fetches directly,
   * in addition to the live memo scan: the collection's known
   * inscriptions. The live scan only covers the most recent memo
   * transactions (see `DEFAULT_SCAN_LIMIT`), and on a busy network
   * that window slides past a mint within seconds, so a mint that
   * aged out of the window would vanish from every count. A
   * registered signature is verified exactly like a scanned one (the
   * memo is parsed from the real transaction and the mint binding is
   * checked); the registry only tells the reader where to look. See
   * ADR 0015.
   */
  knownInscriptions?: string[];
}

/** Error thrown when a config fails validation at load. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function requireString(
  input: Record<string, unknown>,
  field: string,
): string {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

function requirePositiveInteger(
  input: Record<string, unknown>,
  field: string,
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a positive integer.`,
    );
  }
  return value;
}

function requireNonNegativeInteger(
  input: Record<string, unknown>,
  field: string,
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a non-negative integer.`,
    );
  }
  return value;
}

function requireUrl(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  try {
    new URL(value);
  } catch {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a valid URL, got "${value}".`,
    );
  }
  return value;
}

/**
 * Validate and load a collection config from untrusted input (a JSON file,
 * a config object). Throws a `ConfigError` naming the bad field when the
 * input is not a valid collection config.
 */
export function loadCollectionConfig(raw: unknown): CollectionConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(
      "Invalid collection config: collection config must be an object.",
    );
  }
  const input = raw as Record<string, unknown>;

  const tick = requireString(input, "tick");
  if (!TICK_PATTERN.test(tick)) {
    throw new ConfigError(
      `Invalid collection config: "tick" must be 1-10 uppercase letters or digits, got "${tick}".`,
    );
  }

  const priceLamports = requireNonNegativeInteger(input, "priceLamports");
  const treasury = requireOptionalAddress(input, "treasury");
  if (priceLamports > 0 && treasury === undefined) {
    throw new ConfigError(
      `Invalid collection config: "treasury" is required when ` +
        `"priceLamports" is above 0: a priced mint needs a wallet to ` +
        `receive the mint price.`,
    );
  }

  const config: CollectionConfig = {
    tick,
    name: requireString(input, "name"),
    supply: requirePositiveInteger(input, "supply"),
    perWalletLimit: requirePositiveInteger(input, "perWalletLimit"),
    priceLamports,
    image: requireUrl(input, "image"),
    metadataBaseUri: requireUrl(input, "metadataBaseUri"),
  };
  // Set only when present: `exactOptionalPropertyTypes` forbids
  // assigning `undefined` to the optional field.
  if (treasury !== undefined) {
    config.treasury = treasury;
  }
  const knownInscriptions = requireOptionalStringArray(
    input,
    "knownInscriptions",
  );
  if (knownInscriptions !== undefined) {
    config.knownInscriptions = knownInscriptions;
  }
  return config;
}

/**
 * Read an optional Solana address field: absent (or explicitly null)
 * means no address; present means a well-formed base58 address, or a
 * `ConfigError` naming the field.
 */
function requireOptionalAddress(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a Solana address string.`,
    );
  }
  try {
    new PublicKey(value);
  } catch {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be a valid Solana ` +
        `address, got "${value}".`,
    );
  }
  return value;
}

/**
 * Read an optional array-of-strings field: absent (or explicitly null)
 * means no entries; present means an array of non-empty strings, or a
 * `ConfigError` naming the field.
 */
function requireOptionalStringArray(
  input: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new ConfigError(
      `Invalid collection config: "${field}" must be an array of ` +
        `non-empty strings.`,
    );
  }
  return [...(value as string[])];
}

/**
 * The Ghost collection: the demo inscription series shipped with the
 * template. Free mint (price 0 lamports, rent only).
 *
 * The image and metadata URIs point at the hosted Ghost Mint site
 * (Vercel, deployed 19 Nov 2026). The metadata URI is per-mint; the
 * shared ghost.json is served for every per-mint URI by the rewrite
 * rule in the repo-root vercel.json.
 */
export const GHOST_COLLECTION: CollectionConfig = loadCollectionConfig({
  tick: "GHOST",
  name: "Spooky Ghosts",
  supply: 4444,
  perWalletLimit: 4,
  priceLamports: 0,
  image: "https://skelsol-ghost-mint.vercel.app/assets/ghost.svg",
  metadataBaseUri: "https://skelsol-ghost-mint.vercel.app/assets/",
  // The first live devnet mint (20 Nov 2026, minter AqNex3qwMyxzCi6dRTfvmJ8FdMFzMrGDFPXRmWZG1wtK,
  // carrier NFT CzTUinyVnogVvfgH87AruwwAT6QfVZvbAa4CnXwbTP7x). The live
  // scan can no longer reach it — see ADR 0015 — so it is registered
  // here. Add later mints to this list as they age out of the window.
  knownInscriptions: [
    "4LS2AsdKr3KvgzBEM8WW9zE6RBW5fXcT5qtJruZHiNtgdo5o6V1FYKwpgXWrvrY7LisRmJdxWo3JhmmLg4t8H85F",
  ],
});

/** The Solana networks the template supports. */
export type Network = "devnet" | "mainnet";

/**
 * The default network. Devnet, so the demo apps and the CLI try everything
 * for free (see ADR 0005). Mainnet is reached through the network switch.
 */
export const DEFAULT_NETWORK: Network = "devnet";

/** Memo v3 program ID (same on every network). See ADR 0002. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** Metaplex Token Metadata program ID (same on every network). */
export const TOKEN_METADATA_PROGRAM_ID =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/**
 * The escrow (market) program ID for a network, or `null` while the
 * program is not deployed there yet.
 *
 * Never fill these in with a made-up address: `getEscrowProgramId` fails
 * loudly while the value is `null`.
 */
export type EscrowProgramId = string | null;

/** Network config: RPC endpoint and program IDs for one network. */
export interface NetworkConfig {
  network: Network;
  rpcEndpoint: string;
  memoProgramId: string;
  tokenMetadataProgramId: string;
  /** `null` while the escrow program is not deployed on this network. */
  escrowProgramId: EscrowProgramId;
}

const NETWORK_CONFIGS: Record<Network, NetworkConfig> = {
  devnet: {
    network: "devnet",
    rpcEndpoint: "https://api.devnet.solana.com",
    memoProgramId: MEMO_PROGRAM_ID,
    tokenMetadataProgramId: TOKEN_METADATA_PROGRAM_ID,
    // The devnet program ID is final (ticket 07; keypair in
    // ~/.config/solana/skelsol-market.json). Deployed to devnet 19 Nov
    // 2026; see docs/DEPLOY.md.
    escrowProgramId: "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
  },
  mainnet: {
    network: "mainnet",
    rpcEndpoint: "https://api.mainnet.solana.com",
    memoProgramId: MEMO_PROGRAM_ID,
    tokenMetadataProgramId: TOKEN_METADATA_PROGRAM_ID,
    // Mainnet deploy is a manual step for the owner, later.
    escrowProgramId: null,
  },
};

/**
 * Per-network RPC endpoint overrides, set by the host at startup and
 * applied by {@link getNetworkConfig}. The demo apps call
 * {@link setRpcEndpointOverride} with the endpoint their build
 * injected (a dedicated RPC URL from an environment variable, see
 * ADR 0012); the CLI reads its own environment variables and calls
 * it too. Without an override, the public endpoint above is used.
 * The override is validated like any endpoint: it must be an http(s)
 * URL, so a typo fails at startup instead of mid-scan.
 */
const rpcEndpointOverrides = new Map<Network, string>();

/**
 * Override the RPC endpoint for a network, for the lifetime of the
 * page (or process). Throws a `ConfigError` for a value that is not
 * an http(s) URL, and leaves any previous override untouched.
 */
export function setRpcEndpointOverride(network: Network, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(
      `Invalid RPC endpoint for "${network}": "${url}" is not a URL.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(
      `Invalid RPC endpoint for "${network}": "${url}" is not an ` +
        `http(s) URL.`,
    );
  }
  rpcEndpointOverrides.set(network, url);
}

/** Clear all RPC endpoint overrides, restoring the public endpoints. */
export function clearRpcEndpointOverrides(): void {
  rpcEndpointOverrides.clear();
}

/**
 * Return the config for a network. Throws a `ConfigError` for an unknown
 * network name. When an endpoint override was set for the network, the
 * returned config carries the override endpoint (as a copy, so the
 * shared default is never mutated).
 */
export function getNetworkConfig(network: Network): NetworkConfig {
  const config = NETWORK_CONFIGS[network];
  if (config === undefined) {
    throw new ConfigError(
      `Invalid network config: unknown network "${String(network)}". ` +
        `Supported networks: devnet, mainnet.`,
    );
  }
  const override = rpcEndpointOverrides.get(network);
  return override === undefined
    ? config
    : { ...config, rpcEndpoint: override };
}

/**
 * The network's built-in public RPC endpoint, ignoring any override
 * set with {@link setRpcEndpointOverride}. The market read uses it
 * as its fallback: when the configured endpoint fails, the public
 * endpoint gets one try before the read gives up. Throws a
 * `ConfigError` for an unknown network name.
 */
export function getDefaultRpcEndpoint(network: Network): string {
  const config = NETWORK_CONFIGS[network];
  if (config === undefined) {
    throw new ConfigError(
      `Invalid network config: unknown network "${String(network)}". ` +
        `Supported networks: devnet, mainnet.`,
    );
  }
  return config.rpcEndpoint;
}

/**
 * Return the escrow program ID for a network. Throws a `ConfigError` while
 * the escrow program is not deployed on that network yet, so market code
 * fails with a clear message instead of sending a transaction to a
 * placeholder address.
 */
export function getEscrowProgramId(network: Network): string {
  const { escrowProgramId } = getNetworkConfig(network);
  if (escrowProgramId === null) {
    throw new ConfigError(
      `Invalid network config: the escrow program is not deployed on ` +
        `${network} yet. Market actions are unavailable until it is.`,
    );
  }
  return escrowProgramId;
}
