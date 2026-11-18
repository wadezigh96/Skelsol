/**
 * Browser wallet adapter for the Skelsol template.
 *
 * Connects to installed Solana wallets (Phantom, Solflare, Backpack)
 * through the Wallet Standard (see ADR 0008): wallets register
 * themselves in the page, the adapter discovers them with
 * `getWallets()`, connects with the `standard:connect` feature, and
 * signs with the `solana:signTransaction` feature.
 *
 * The page never asks for a seed phrase or a private key. The wallet
 * signs; the adapter only builds unsigned transactions and hands them
 * to the wallet. Transactions are legacy web3.js transactions (not v1),
 * so wallets that cannot sign v1 transactions (Ledger) still work.
 *
 * The adapter is framework-free and importable in Node: the only
 * browser contact is the Wallet Standard registration, which
 * `getWallets()` itself guards for a missing `window`.
 */

import { getWallets } from "@wallet-standard/app";
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
} from "@solana/wallet-standard-features";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { DEFAULT_NETWORK, getNetworkConfig, type Network } from "./config.js";

/** Error thrown by the wallet adapter, with a message fit to show a user. */
export class WalletError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WalletError";
  }
}

/** A wallet account, as the Wallet Standard describes it. */
type WalletAccount = SolanaSignTransactionInput["account"];

/** A registered Wallet Standard wallet, as `getWallets()` returns it. */
type StandardWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];

/** The `solana:signTransaction` feature object, in the shape the adapter uses. */
type SignTransactionFeature = SolanaSignTransactionFeature[typeof SolanaSignTransaction];

/**
 * The `standard:connect` feature, in the shape the adapter uses.
 * (`@wallet-standard/features` is not a direct dependency, so the
 * feature is described here instead of imported.)
 */
interface ConnectFeature {
  readonly connect: (input?: { readonly silent?: boolean }) => Promise<{
    readonly accounts: readonly WalletAccount[];
  }>;
}

/** The `standard:disconnect` feature, in the shape the adapter uses. */
interface DisconnectFeature {
  readonly disconnect: () => Promise<void>;
}

/** Feature name for connecting a wallet. */
const STANDARD_CONNECT = "standard:connect";
/** Feature name for disconnecting a wallet. */
const STANDARD_DISCONNECT = "standard:disconnect";

/** One installed wallet, as shown in a wallet picker. */
export interface WalletInfo {
  /** Display name, e.g. `Phantom`. */
  readonly name: string;
  /** Wallet icon as a data URI. */
  readonly icon: string;
}

/**
 * True when the value looks like a `standard:connect` feature. Wallet
 * objects come from browser extensions, so features are checked at
 * runtime instead of trusted.
 */
function isConnectFeature(value: unknown): value is ConnectFeature {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { connect?: unknown }).connect === "function"
  );
}

/** True when the value looks like a `solana:signTransaction` feature. */
function isSignTransactionFeature(
  value: unknown,
): value is SignTransactionFeature {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { signTransaction?: unknown }).signTransaction ===
      "function" &&
    Array.isArray(
      (value as { supportedTransactionVersions?: unknown })
        .supportedTransactionVersions,
    )
  );
}

/** True when the value looks like a `standard:disconnect` feature. */
function isDisconnectFeature(value: unknown): value is DisconnectFeature {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { disconnect?: unknown }).disconnect === "function"
  );
}

/**
 * Wallets the adapter can actually use: registered wallets that offer
 * both `standard:connect` and `solana:signTransaction`. A wallet
 * without either feature cannot connect or sign, so it is not listed.
 */
function usableWallets(): readonly StandardWallet[] {
  return getWallets()
    .get()
    .filter(
      (wallet) =>
        isConnectFeature(wallet.features[STANDARD_CONNECT]) &&
        isSignTransactionFeature(
          wallet.features[SolanaSignTransaction],
        ),
    );
}

/**
 * The browser wallet connection layer. One adapter holds one wallet
 * connection on one network; `setNetwork` moves it between devnet and
 * mainnet (see ADR 0005) and the `Connection` follows.
 */
export class WalletAdapter {
  private networkValue: Network;
  private connectionValue: Connection | null = null;
  private walletValue: StandardWallet | null = null;
  private accountValue: WalletAccount | null = null;

  /**
   * Build an adapter for a network. Defaults to devnet, so the demo
   * apps try everything for free. Throws a `ConfigError` for an
   * unknown network name.
   */
  constructor(network: Network = DEFAULT_NETWORK) {
    // Validate through config so a bad network fails fast here.
    getNetworkConfig(network);
    this.networkValue = network;
  }

  /** The network the adapter is on. */
  get network(): Network {
    return this.networkValue;
  }

  /** True once a wallet has connected. */
  get connected(): boolean {
    return this.accountValue !== null;
  }

  /** The connected wallet's public key, or `null` before connecting. */
  get publicKey(): PublicKey | null {
    return this.accountValue === null
      ? null
      : new PublicKey(Uint8Array.from(this.accountValue.publicKey));
  }

  /** The connected wallet's name, or `null` before connecting. */
  get walletName(): string | null {
    return this.walletValue?.name ?? null;
  }

  /**
   * The RPC connection for the active network. Built lazily from the
   * network config and rebuilt after a network switch.
   */
  getConnection(): Connection {
    if (this.connectionValue === null) {
      this.connectionValue = new Connection(
        getNetworkConfig(this.networkValue).rpcEndpoint,
        "confirmed",
      );
    }
    return this.connectionValue;
  }

  /**
   * Move the adapter to another network. The RPC connection is rebuilt
   * on next use; the wallet connection itself is network-independent,
   * so a connected wallet stays connected.
   */
  setNetwork(network: Network): void {
    getNetworkConfig(network);
    if (network !== this.networkValue) {
      this.networkValue = network;
      this.connectionValue = null;
    }
  }

  /**
   * List the installed wallets the adapter can use, by name and icon.
   * Returns an empty list when no usable wallet is installed.
   */
  discoverWallets(): readonly WalletInfo[] {
    return usableWallets().map((wallet) => ({
      name: wallet.name,
      icon: wallet.icon,
    }));
  }

  /**
   * Connect to a wallet by name (as listed by `discoverWallets`) and
   * return the connected account's public key. The wallet may prompt
   * the user to approve the connection.
   *
   * Throws a `WalletError` when no wallet is installed, when the named
   * wallet is not installed, when the wallet refuses the connection,
   * or when the wallet shares no account.
   */
  async connect(walletName: string): Promise<PublicKey> {
    const wallets = usableWallets();
    if (wallets.length === 0) {
      throw new WalletError(
        "No Solana wallet is installed. Install Phantom, Solflare, or " +
          "Backpack, then try again.",
      );
    }
    const wallet = wallets.find(
      (candidate) => candidate.name === walletName,
    );
    if (wallet === undefined) {
      const available = wallets
        .map((candidate) => candidate.name)
        .join(", ");
      throw new WalletError(
        `Wallet "${walletName}" is not installed. ` +
          `Installed wallets: ${available}.`,
      );
    }

    // The filter in `usableWallets` already checked this feature, so
    // the guard here is a safety net, not a path tests exercise.
    const feature = wallet.features[STANDARD_CONNECT];
    if (!isConnectFeature(feature)) {
      throw new WalletError(
        `Wallet "${walletName}" cannot connect (missing standard:connect).`,
      );
    }

    let accounts: readonly WalletAccount[];
    try {
      ({ accounts } = await feature.connect());
    } catch (error) {
      throw new WalletError(
        `Wallet "${walletName}" refused the connection.`,
        { cause: error },
      );
    }
    const account = accounts[0];
    if (account === undefined) {
      throw new WalletError(
        `Wallet "${walletName}" did not share an account. ` +
          `Try connecting again.`,
      );
    }
    this.walletValue = wallet;
    this.accountValue = account;
    return new PublicKey(Uint8Array.from(account.publicKey));
  }

  /**
   * Sign an unsigned legacy transaction with the connected wallet and
   * return the signed transaction. The caller sends it (or hands it to
   * code that does); this adapter never sends a transaction itself.
   *
   * Throws a `WalletError` when no wallet is connected, when the
   * wallet cannot sign legacy transactions, or when the wallet refuses
   * to sign.
   */
  async signTransaction(transaction: Transaction): Promise<Transaction> {
    const wallet = this.walletValue;
    const account = this.accountValue;
    if (wallet === null || account === null) {
      throw new WalletError(
        "No wallet is connected. Connect a wallet before signing.",
      );
    }

    // The filter in `usableWallets` already checked this feature, so
    // the guard here is a safety net, not a path tests exercise.
    const feature = wallet.features[SolanaSignTransaction];
    if (!isSignTransactionFeature(feature)) {
      throw new WalletError(
        `Wallet "${wallet.name}" cannot sign transactions ` +
          `(missing solana:signTransaction).`,
      );
    }
    if (!feature.supportedTransactionVersions.includes("legacy")) {
      throw new WalletError(
        `Wallet "${wallet.name}" cannot sign legacy transactions. ` +
          `Skelsol builds legacy transactions so every wallet can sign them.`,
      );
    }

    const serialized = transaction.serialize({
      requireAllSignatures: false,
    });
    let outputs: readonly { readonly signedTransaction: Uint8Array }[];
    try {
      outputs = await feature.signTransaction({
        account,
        transaction: serialized,
      });
    } catch (error) {
      throw new WalletError(
        `Wallet "${wallet.name}" refused to sign the transaction.`,
        { cause: error },
      );
    }
    const output = outputs[0];
    if (output === undefined) {
      throw new WalletError(
        `Wallet "${wallet.name}" returned no signed transaction.`,
      );
    }
    return Transaction.from(output.signedTransaction);
  }

  /**
   * Disconnect the wallet. Tells the wallet to disconnect too when it
   * offers `standard:disconnect`; a wallet that refuses still leaves
   * the adapter disconnected.
   */
  async disconnect(): Promise<void> {
    const wallet = this.walletValue;
    this.walletValue = null;
    this.accountValue = null;
    const feature = wallet?.features[STANDARD_DISCONNECT];
    if (isDisconnectFeature(feature)) {
      try {
        await feature.disconnect();
      } catch {
        // Best effort: the adapter is already disconnected.
      }
    }
  }
}
