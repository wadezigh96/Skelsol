import { getWallets } from "@wallet-standard/app";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";

import { WalletAdapter, WalletError } from "./wallet.js";

/** A registered Wallet Standard wallet, as `getWallets()` returns it. */
type StandardWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];

const PHANTOM_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

/**
 * Build a fake Wallet Standard wallet backed by a real keypair, so the
 * mock signs transactions for real and the tests can verify the
 * signatures. Registered with `getWallets().register()` like a real
 * browser extension would register itself.
 */
function createMockWallet(options?: {
  name?: string;
  keypair?: Keypair;
  /** Include the `standard:connect` feature. Defaults to true. */
  withConnect?: boolean;
  /** Include the `solana:signTransaction` feature. Defaults to true. */
  withSignTransaction?: boolean;
  /** Transaction versions the mock claims to support. Defaults to legacy. */
  supportedTransactionVersions?: readonly ("legacy" | 0 | 1)[];
  /** Accounts `connect()` returns. Defaults to one account for the keypair. */
  connectAccounts?: "one" | "none";
}): { wallet: StandardWallet; keypair: Keypair } {
  const keypair = options?.keypair ?? Keypair.generate();
  const account = {
    address: keypair.publicKey.toBase58(),
    publicKey: keypair.publicKey.toBytes(),
    chains: ["solana:devnet", "solana:mainnet"],
    features: ["standard:connect", "solana:signTransaction"],
  };

  const features: Record<string, unknown> = {};
  if (options?.withConnect !== false) {
    features["standard:connect"] = {
      version: "1.0.0",
      connect: async () => ({
        accounts:
          options?.connectAccounts === "none" ? [] : [account],
      }),
    };
  }
  if (options?.withSignTransaction !== false) {
    features["solana:signTransaction"] = {
      version: "1.0.0",
      supportedTransactionVersions:
        options?.supportedTransactionVersions ?? ["legacy"],
      signTransaction: async (
        ...inputs: readonly { transaction: Uint8Array }[]
      ) =>
        inputs.map((input) => {
          const transaction = Transaction.from(input.transaction);
          transaction.partialSign(keypair);
          return { signedTransaction: transaction.serialize() };
        }),
    };
  }

  const wallet = {
    version: "1.0.0",
    name: options?.name ?? "Mock Phantom",
    icon: PHANTOM_ICON,
    chains: ["solana:devnet", "solana:mainnet"],
    features,
    accounts: [],
  } as unknown as StandardWallet;
  return { wallet, keypair };
}

/** A minimal unsigned legacy transaction (a 0-lamport transfer). */
function createUnsignedTransaction(feePayer: PublicKey): Transaction {
  const transaction = new Transaction({
    feePayer,
    // A valid base58 blockhash shape; no RPC call is made, so any
    // 32-byte value works here.
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  });
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 0,
    }),
  );
  return transaction;
}

/** Unregister functions for every mock wallet registered in a test. */
let unregisterMocks: (() => void)[] = [];

afterEach(() => {
  for (const unregister of unregisterMocks) {
    unregister();
  }
  unregisterMocks = [];
});

function registerMockWallet(
  options?: Parameters<typeof createMockWallet>[0],
): { wallet: StandardWallet; keypair: Keypair } {
  const created = createMockWallet(options);
  unregisterMocks.push(getWallets().register(created.wallet));
  return created;
}

describe("discoverWallets", () => {
  it("returns an empty list when no wallet is installed", () => {
    const adapter = new WalletAdapter();

    expect(adapter.discoverWallets()).toEqual([]);
  });

  it("lists a registered wallet by name and icon", () => {
    registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();

    expect(adapter.discoverWallets()).toEqual([
      { name: "Mock Phantom", icon: PHANTOM_ICON },
    ]);
  });

  it("lists only wallets that can connect and sign transactions", () => {
    registerMockWallet({ name: "Mock Phantom" });
    registerMockWallet({ name: "No Sign Wallet", withSignTransaction: false });
    registerMockWallet({ name: "No Connect Wallet", withConnect: false });
    const adapter = new WalletAdapter();

    expect(adapter.discoverWallets()).toEqual([
      { name: "Mock Phantom", icon: PHANTOM_ICON },
    ]);
  });
});

describe("connect", () => {
  it("connects to a chosen wallet and returns its public key", async () => {
    const { keypair } = registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();

    const publicKey = await adapter.connect("Mock Phantom");

    expect(publicKey.equals(keypair.publicKey)).toBe(true);
    expect(adapter.connected).toBe(true);
    expect(adapter.walletName).toBe("Mock Phantom");
    expect(adapter.publicKey?.equals(keypair.publicKey)).toBe(true);
  });

  it("throws a clear error when no wallet is installed", async () => {
    const adapter = new WalletAdapter();

    await expect(adapter.connect("Phantom")).rejects.toThrowError(
      WalletError,
    );
    await expect(adapter.connect("Phantom")).rejects.toThrowError(
      /No Solana wallet is installed/,
    );
  });

  it("throws a clear error naming the available wallets when the chosen wallet is missing", async () => {
    registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();

    await expect(adapter.connect("Solflare")).rejects.toThrowError(
      /Wallet "Solflare" is not installed\. Installed wallets: Mock Phantom/,
    );
  });

  it("throws a clear error when the wallet shares no account", async () => {
    registerMockWallet({ name: "Mock Phantom", connectAccounts: "none" });
    const adapter = new WalletAdapter();

    await expect(adapter.connect("Mock Phantom")).rejects.toThrowError(
      /did not share an account/,
    );
    expect(adapter.connected).toBe(false);
  });
});

describe("signTransaction", () => {
  it("signs an unsigned legacy transaction with the connected wallet", async () => {
    const { keypair } = registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();
    await adapter.connect("Mock Phantom");
    const transaction = createUnsignedTransaction(keypair.publicKey);

    const signed = await adapter.signTransaction(transaction);

    // The signature verifies against the connected public key, and the
    // transaction is still the same legacy transaction (same instructions).
    expect(signed.verifySignatures()).toBe(true);
    expect(signed.instructions).toHaveLength(1);
    expect(signed.feePayer?.equals(keypair.publicKey)).toBe(true);
  });

  it("throws a clear error when no wallet is connected", async () => {
    const adapter = new WalletAdapter();
    const transaction = createUnsignedTransaction(
      Keypair.generate().publicKey,
    );

    await expect(adapter.signTransaction(transaction)).rejects.toThrowError(
      /No wallet is connected/,
    );
  });

  it("throws a clear error when the wallet cannot sign legacy transactions", async () => {
    registerMockWallet({
      name: "Mock Phantom",
      supportedTransactionVersions: [1],
    });
    const adapter = new WalletAdapter();
    await adapter.connect("Mock Phantom");
    const transaction = createUnsignedTransaction(
      Keypair.generate().publicKey,
    );

    await expect(adapter.signTransaction(transaction)).rejects.toThrowError(
      /cannot sign legacy transactions/,
    );
  });
});

describe("network", () => {
  it("defaults to devnet and exposes a devnet connection", () => {
    const adapter = new WalletAdapter();

    expect(adapter.network).toBe("devnet");
    expect(adapter.getConnection().rpcEndpoint).toBe(
      "https://api.devnet.solana.com",
    );
  });

  it("starts on mainnet when constructed with mainnet", () => {
    const adapter = new WalletAdapter("mainnet");

    expect(adapter.network).toBe("mainnet");
    expect(adapter.getConnection().rpcEndpoint).toBe(
      "https://api.mainnet.solana.com",
    );
  });

  it("follows the active network when switched", () => {
    const adapter = new WalletAdapter();

    adapter.setNetwork("mainnet");

    expect(adapter.network).toBe("mainnet");
    expect(adapter.getConnection().rpcEndpoint).toBe(
      "https://api.mainnet.solana.com",
    );
  });

  it("keeps the wallet connected across a network switch", async () => {
    const { keypair } = registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();
    await adapter.connect("Mock Phantom");

    adapter.setNetwork("mainnet");

    expect(adapter.connected).toBe(true);
    expect(adapter.publicKey?.equals(keypair.publicKey)).toBe(true);
  });
});

describe("disconnect", () => {
  it("clears the connection so signing requires connecting again", async () => {
    const { keypair } = registerMockWallet({ name: "Mock Phantom" });
    const adapter = new WalletAdapter();
    await adapter.connect("Mock Phantom");

    await adapter.disconnect();

    expect(adapter.connected).toBe(false);
    expect(adapter.publicKey).toBeNull();
    expect(adapter.walletName).toBeNull();
    const transaction = createUnsignedTransaction(keypair.publicKey);
    await expect(adapter.signTransaction(transaction)).rejects.toThrowError(
      /No wallet is connected/,
    );
  });
});
