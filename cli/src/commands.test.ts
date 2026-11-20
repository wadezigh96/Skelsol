import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { GHOST_COLLECTION, deriveListingAddress } from "@skelsol/template";

import { parseArgs, type ParsedArgs } from "./args.js";
import { runCommand, type RunDeps } from "./commands.js";
import { KeypairError } from "./keypair.js";
import { ProgramNotDeployedError } from "./program.js";

const BLOCKHASH = "11111111111111111111111111111111";
const FAKE_SIGNATURE = "11111111111111111111111111111111";
const PROGRAM_ID = new PublicKey(
  "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
);

const agentKeypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
const sellerKeypair = Keypair.fromSeed(new Uint8Array(32).fill(9));
const mintKeypair = Keypair.fromSeed(new Uint8Array(32).fill(3));

/** A recorded mint transaction, in the shape the reader reads. */
function makeMintTx(
  mint: string,
  owner: string,
  signature: string,
  slot: number,
): Record<string, unknown> {
  const memo = JSON.stringify({
    p: "spl-20",
    op: "mint",
    tick: "GHOST",
    amt: "1",
    mint,
  });
  return {
    slot,
    blockTime: 1_700_000_000 + slot,
    meta: {
      err: null,
      logMessages: [
        `Program log: Memo (len ${memo.length}): ${JSON.stringify(memo)}`,
      ],
      preTokenBalances: [],
      postTokenBalances: [
        { mint, owner, uiTokenAmount: { amount: "1" } },
      ],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [
          { pubkey: new PublicKey(owner), signer: true, writable: true },
        ],
      },
    },
  };
}

/** A Listing account buffer, in the on-chain Borsh layout. */
function encodeListing(
  seller: PublicKey,
  mint: PublicKey,
  price: bigint,
  bump: number,
): Buffer {
  const data = Buffer.alloc(81);
  Buffer.from([218, 32, 50, 73, 43, 134, 26, 58]).copy(data, 0);
  Buffer.from(seller.toBytes()).copy(data, 8);
  Buffer.from(mint.toBytes()).copy(data, 40);
  data.writeBigUInt64LE(price, 72);
  data.writeUInt8(bump, 80);
  return data;
}

interface FakeConnectionOptions {
  /** Mint transactions the reader scan finds (empty by default). */
  mintTxs?: Array<Record<string, unknown>>;
  /**
   * A mint transaction returned for the collection's registered
   * signature, as if its mint aged out of the live window (none by
   * default: the registered fetch then returns null, pruned).
   */
  registeredTx?: Record<string, unknown>;
  /** Signatures whose getParsedTransaction throws (none by default). */
  failingSignatures?: Set<string>;
  /** Whether the escrow program account exists (false by default). */
  programDeployed?: boolean;
  /** Listing accounts getProgramAccounts returns (empty by default). */
  programAccounts?: Array<{ pubkey: PublicKey; account: { data: Buffer } }>;
  /** Listing accounts getAccountInfo returns, keyed by address. */
  accounts?: Map<string, Buffer>;
}

/** A fake web3.js Connection: no network, everything recorded. */
function createFakeConnection(options: FakeConnectionOptions = {}) {
  const mintTxs = options.mintTxs ?? [];
  const registeredSignature = GHOST_COLLECTION.knownInscriptions?.[0];
  const sent: Buffer[] = [];
  const confirmed: string[] = [];
  const connection = {
    sent,
    confirmed,
    async getSignaturesForAddress(): Promise<
      Array<{ signature: string; slot: number; err: null; blockTime: number }>
    > {
      return mintTxs.map((tx, index) => ({
        signature: `sig-${index + 1}`,
        slot: (tx["slot"] as number) ?? index + 1,
        err: null,
        blockTime: (tx["blockTime"] as number) ?? null,
      }));
    },
    async getParsedTransaction(
      signature: string,
    ): Promise<Record<string, unknown> | null> {
      if (options.failingSignatures?.has(signature) === true) {
        throw new Error("boom");
      }
      if (
        registeredSignature !== undefined &&
        signature === registeredSignature &&
        options.registeredTx !== undefined
      ) {
        return options.registeredTx;
      }
      const index = Number(signature.replace("sig-", "")) - 1;
      return mintTxs[index] ?? null;
    },
    async getProgramAccounts(): Promise<
      Array<{ pubkey: PublicKey; account: { data: Buffer } }>
    > {
      return options.programAccounts ?? [];
    },
    async getAccountInfo(
      pubkey: PublicKey,
    ): Promise<{ data: Buffer } | null> {
      if (pubkey.equals(PROGRAM_ID)) {
        return options.programDeployed === true
          ? { data: Buffer.alloc(10) }
          : null;
      }
      const found = options.accounts?.get(pubkey.toBase58());
      return found === undefined ? null : { data: found };
    },
    async getMinimumBalanceForRentExemption(size: number): Promise<number> {
      return (size + 128) * 1000;
    },
    async getLatestBlockhash(): Promise<{
      blockhash: string;
      lastValidBlockHeight: number;
    }> {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1 };
    },
    async sendRawTransaction(raw: Buffer | Uint8Array): Promise<string> {
      sent.push(Buffer.from(raw));
      return FAKE_SIGNATURE;
    },
    async confirmTransaction(
      signature: string,
    ): Promise<{ value: { err: null } }> {
      confirmed.push(signature);
      return { value: { err: null } };
    },
  };
  return connection;
}

type FakeConnection = ReturnType<typeof createFakeConnection>;

interface DepsOptions {
  confirmAnswer?: boolean;
  keypair?: Keypair;
  keypairError?: Error;
}

function makeDeps(connection: FakeConnection, options: DepsOptions = {}) {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const prompts: string[] = [];
  let confirmCalls = 0;
  const deps: RunDeps = {
    connection: connection as unknown as Connection,
    confirm: async (prompt: string) => {
      confirmCalls += 1;
      prompts.push(prompt);
      return options.confirmAnswer ?? true;
    },
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
    stderr: (line: string) => {
      stderrLines.push(line);
    },
    readKeypair: () => {
      if (options.keypairError !== undefined) {
        throw options.keypairError;
      }
      if (options.keypair === undefined) {
        throw new Error("readKeypair must not be called for this command");
      }
      return options.keypair;
    },
  };
  return {
    deps,
    stdoutLines,
    stderrLines,
    prompts,
    confirmCalls: () => confirmCalls,
  };
}

function mustParse(argv: string[]): ParsedArgs {
  const parsed = parseArgs(argv);
  if ("help" in parsed) {
    throw new Error(`expected a command, got help for ${argv.join(" ")}`);
  }
  return parsed;
}

describe("runCommand: status", () => {
  it("shows collection state without a keypair, and says the floor is unavailable while the program is not deployed", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection);
    const exit = await runCommand(mustParse(["status"]), harness.deps);
    expect(exit).toBe(0);
    const out = harness.stdoutLines.join("\n");
    expect(out).toMatch(/minted: 0 of 4444/i);
    expect(out).toMatch(/minters: 0/i);
    expect(out).toMatch(/floor price/i);
    expect(out).toMatch(/market program is not deployed on devnet yet/i);
    expect(harness.stderrLines).toEqual([]);
  });

  it("shows the floor price once the program is deployed and listings exist", async () => {
    const seller = sellerKeypair.publicKey;
    const mintA = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
    const mintB = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
    const listingA = deriveListingAddress(seller, mintA, "devnet");
    const listingB = deriveListingAddress(seller, mintB, "devnet");
    const connection = createFakeConnection({
      programDeployed: true,
      programAccounts: [
        {
          pubkey: listingA.address,
          account: {
            data: encodeListing(seller, mintA, 2_000_000_000n, listingA.bump),
          },
        },
        {
          pubkey: listingB.address,
          account: {
            data: encodeListing(seller, mintB, 1_000_000_000n, listingB.bump),
          },
        },
      ],
    });
    const harness = makeDeps(connection);
    const exit = await runCommand(mustParse(["status"]), harness.deps);
    expect(exit).toBe(0);
    expect(harness.stdoutLines.join("\n")).toMatch(/floor price: 1 SOL/i);
  });

  it("says there are no open listings when the program is deployed but empty", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection);
    await runCommand(mustParse(["status"]), harness.deps);
    expect(harness.stdoutLines.join("\n")).toMatch(/no open listings/i);
  });

  it("prints parseable JSON on stdout only, with the floor as a string, in --json mode", async () => {
    const seller = sellerKeypair.publicKey;
    const mint = mintKeypair.publicKey;
    const listing = deriveListingAddress(seller, mint, "devnet");
    const connection = createFakeConnection({
      programDeployed: true,
      programAccounts: [
        {
          pubkey: listing.address,
          account: {
            data: encodeListing(seller, mint, 1_500_000_000n, listing.bump),
          },
        },
      ],
    });
    const harness = makeDeps(connection);
    const exit = await runCommand(
      mustParse(["status", "--json"]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(harness.stderrLines).toEqual([]);
    expect(harness.stdoutLines).toHaveLength(1);
    const json = JSON.parse(harness.stdoutLines[0] as string) as Record<
      string,
      unknown
    >;
    expect(json["command"]).toBe("status");
    expect(json["network"]).toBe("devnet");
    expect(json["minted"]).toBe(0);
    expect(json["supply"]).toBe(4444);
    expect(json["floorPriceLamports"]).toBe("1500000000");
    expect(json["floorPrice"]).toBe("1.5 SOL");
    expect(json["marketStatus"]).toBe("live");
  });

  it("reports the market as not-deployed in JSON instead of faking a floor", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection);
    await runCommand(mustParse(["status", "--json"]), harness.deps);
    const json = JSON.parse(harness.stdoutLines[0] as string) as Record<
      string,
      unknown
    >;
    expect(json["floorPriceLamports"]).toBeNull();
    expect(json["marketStatus"]).toBe("not-deployed");
    expect(json["marketMessage"]).toMatch(
      /market program is not deployed on devnet yet/i,
    );
  });

  it("warns in plain words when some records could not be read", async () => {
    const connection = createFakeConnection({
      mintTxs: [{}],
      failingSignatures: new Set(["sig-1"]),
    });
    const harness = makeDeps(connection);
    const exit = await runCommand(mustParse(["status"]), harness.deps);
    expect(exit).toBe(0);
    // One live record failed; the scan examined two records in total
    // (the live one plus the registered first mint).
    expect(harness.stdoutLines.join("\n")).toMatch(
      /warning: 1 of 2 records could not be read/i,
    );
    expect(harness.stdoutLines.join("\n")).toMatch(/may be incomplete/i);
  });

  it("reports scanned and failedFetches in JSON", async () => {
    const connection = createFakeConnection({
      mintTxs: [{}],
      failingSignatures: new Set(["sig-1"]),
    });
    const harness = makeDeps(connection);
    await runCommand(mustParse(["status", "--json"]), harness.deps);
    const json = JSON.parse(harness.stdoutLines[0] as string) as Record<
      string,
      unknown
    >;
    expect(json["scanned"]).toBe(2);
    expect(json["failedFetches"]).toBe(1);
    expect(json["fromRegistry"]).toBe(0);
  });

  it("says how many verified inscriptions came from the collection registry", async () => {
    const connection = createFakeConnection({
      registeredTx: makeMintTx(
        mintKeypair.publicKey.toBase58(),
        agentKeypair.publicKey.toBase58(),
        GHOST_COLLECTION.knownInscriptions?.[0] ?? "registered-sig",
        7,
      ),
    });
    const harness = makeDeps(connection);
    const exit = await runCommand(mustParse(["status"]), harness.deps);
    expect(exit).toBe(0);
    const out = harness.stdoutLines.join("\n");
    expect(out).toMatch(/minted: 1 of 4444/i);
    expect(out).toMatch(/verified from the collection registry: 1/i);
  });
});

describe("runCommand: lookup", () => {
  it("lists a wallet's inscriptions without a keypair", async () => {
    const wallet = agentKeypair.publicKey.toBase58();
    const mint = mintKeypair.publicKey.toBase58();
    const connection = createFakeConnection({
      mintTxs: [makeMintTx(mint, wallet, "sig-1", 1)],
    });
    const harness = makeDeps(connection);
    const exit = await runCommand(
      mustParse(["lookup", wallet]),
      harness.deps,
    );
    expect(exit).toBe(0);
    const out = harness.stdoutLines.join("\n");
    expect(out).toMatch(/1 GHOST inscription/i);
    expect(out).toContain(mint);
    expect(out).toContain("explorer.solana.com");
    expect(harness.stderrLines).toEqual([]);
  });

  it("says zero when the wallet holds nothing", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection);
    await runCommand(
      mustParse(["lookup", agentKeypair.publicKey.toBase58()]),
      harness.deps,
    );
    expect(harness.stdoutLines.join("\n")).toMatch(/0 GHOST inscriptions/i);
  });

  it("prints parseable JSON in --json mode", async () => {
    const wallet = agentKeypair.publicKey.toBase58();
    const mint = mintKeypair.publicKey.toBase58();
    const connection = createFakeConnection({
      mintTxs: [makeMintTx(mint, wallet, "sig-1", 1)],
    });
    const harness = makeDeps(connection);
    await runCommand(mustParse(["lookup", wallet, "--json"]), harness.deps);
    expect(harness.stdoutLines).toHaveLength(1);
    const json = JSON.parse(harness.stdoutLines[0] as string) as Record<
      string,
      unknown
    >;
    expect(json["command"]).toBe("lookup");
    expect(json["count"]).toBe(1);
    const inscriptions = json["inscriptions"] as Array<Record<string, unknown>>;
    expect(inscriptions[0]?.["mint"]).toBe(mint);
  });

  it("refuses an invalid wallet address with a clear error", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection);
    await expect(
      runCommand(mustParse(["lookup", "not-an-address"]), harness.deps),
    ).rejects.toThrow(/invalid wallet address/i);
  });
});

describe("runCommand: mint", () => {
  it("previews on stderr, confirms, sends, and prints the signature and explorer link", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    const exit = await runCommand(
      mustParse(["mint", "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(harness.confirmCalls()).toBe(1);
    expect(connection.sent).toHaveLength(1);
    expect(connection.confirmed).toEqual([FAKE_SIGNATURE]);
    const preview = harness.stderrLines.join("\n");
    expect(preview).toMatch(/preview/i);
    expect(preview).toMatch(/"p":"spl-20"/);
    expect(preview).toMatch(/total/i);
    expect(preview).toMatch(/network fee/i);
    expect(preview).toMatch(/SOL/);
    const out = harness.stdoutLines.join("\n");
    expect(out).toContain(FAKE_SIGNATURE);
    expect(out).toContain("explorer.solana.com");
  });

  it("keeps stdout JSON-only in --json mode, with the preview on stderr", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    const exit = await runCommand(
      mustParse(["mint", "--keypair", "agent.json", "--json"]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(harness.stdoutLines).toHaveLength(1);
    const json = JSON.parse(harness.stdoutLines[0] as string) as Record<
      string,
      unknown
    >;
    expect(json["command"]).toBe("mint");
    expect(json["signature"]).toBe(FAKE_SIGNATURE);
    expect(typeof json["mint"]).toBe("string");
    expect(json["inscriptionJson"]).toMatch(/"p":"spl-20"/);
    const cost = json["cost"] as Record<string, unknown>;
    expect(typeof cost["totalLamports"]).toBe("number");
    expect(harness.stderrLines.join("\n")).toMatch(/preview/i);
  });

  it("sends nothing when the user does not confirm", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, {
      keypair: agentKeypair,
      confirmAnswer: false,
    });
    const exit = await runCommand(
      mustParse(["mint", "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(1);
    expect(connection.sent).toHaveLength(0);
    expect(harness.stdoutLines).toEqual([]);
    expect(harness.stderrLines.join("\n")).toMatch(/aborted/i);
    expect(harness.stderrLines.join("\n")).toMatch(/not sent/i);
  });

  it("refuses without --keypair", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(runCommand(mustParse(["mint"]), harness.deps)).rejects.toThrow(
      /--keypair/i,
    );
    expect(connection.sent).toHaveLength(0);
  });

  it("surfaces a keypair loading error and sends nothing", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, {
      keypairError: new KeypairError('Keypair file not found: "nope.json".'),
    });
    await expect(
      runCommand(mustParse(["mint", "--keypair", "nope.json"]), harness.deps),
    ).rejects.toThrow(KeypairError);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses when the wallet already hit its per-wallet limit", async () => {
    const wallet = agentKeypair.publicKey.toBase58();
    const mintTxs = [11, 12, 13, 14].map((seed, index) =>
      makeMintTx(
        Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey.toBase58(),
        wallet,
        `sig-${index + 1}`,
        index + 1,
      ),
    );
    const connection = createFakeConnection({ mintTxs });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(mustParse(["mint", "--keypair", "agent.json"]), harness.deps),
    ).rejects.toThrow(/per-wallet limit/i);
    expect(connection.sent).toHaveLength(0);
  });
});

describe("runCommand: list", () => {
  const mint = mintKeypair.publicKey.toBase58();

  it("refuses with the not-deployed message while the program is missing", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse(["list", mint, "1000000000", "--keypair", "agent.json"]),
        harness.deps,
      ),
    ).rejects.toThrow(ProgramNotDeployedError);
    await expect(
      runCommand(
        mustParse(["list", mint, "1000000000", "--keypair", "agent.json"]),
        harness.deps,
      ),
    ).rejects.toThrow(/market program is not deployed on devnet yet/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("previews, confirms, and sends with a fresh blockhash once deployed", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    const exit = await runCommand(
      mustParse(["list", mint, "1000000000", "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(connection.sent).toHaveLength(1);
    const sent = Transaction.from(connection.sent[0] as Buffer);
    expect(sent.recentBlockhash).toBe(BLOCKHASH);
    const preview = harness.stderrLines.join("\n");
    expect(preview).toMatch(/preview/i);
    expect(preview).toContain(mint);
    expect(preview).toMatch(/1 SOL/);
    expect(preview).toMatch(/1000000000 lamports/);
    expect(harness.stdoutLines.join("\n")).toContain(FAKE_SIGNATURE);
  });

  it("sends nothing when the user does not confirm", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, {
      keypair: agentKeypair,
      confirmAnswer: false,
    });
    const exit = await runCommand(
      mustParse(["list", mint, "1000000000", "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(1);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses a price that does not fit in a u64", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse([
          "list",
          mint,
          "18446744073709551616",
          "--keypair",
          "agent.json",
        ]),
        harness.deps,
      ),
    ).rejects.toThrow(/invalid price/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses an invalid mint address", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse(["list", "nope", "1000", "--keypair", "agent.json"]),
        harness.deps,
      ),
    ).rejects.toThrow(/invalid mint address/i);
  });
});

describe("runCommand: buy", () => {
  const seller = sellerKeypair.publicKey;
  const mint = mintKeypair.publicKey;

  function deployedWithListing(price: bigint) {
    const listing = deriveListingAddress(seller, mint, "devnet");
    const accounts = new Map<string, Buffer>();
    accounts.set(
      listing.address.toBase58(),
      encodeListing(seller, mint, price, listing.bump),
    );
    return {
      connection: createFakeConnection({
        programDeployed: true,
        accounts,
      }),
      listing,
    };
  }

  it("refuses with the not-deployed message while the program is missing", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse([
          "buy",
          seller.toBase58(),
          mint.toBase58(),
          "--keypair",
          "agent.json",
        ]),
        harness.deps,
      ),
    ).rejects.toThrow(/market program is not deployed on devnet yet/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses when the listing is gone", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse([
          "buy",
          seller.toBase58(),
          mint.toBase58(),
          "--keypair",
          "agent.json",
        ]),
        harness.deps,
      ),
    ).rejects.toThrow(/listing gone/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("previews the exact stored price and fee split, then sends", async () => {
    const { connection } = deployedWithListing(1_000_000_000n);
    const harness = makeDeps(connection, { keypair: agentKeypair });
    const exit = await runCommand(
      mustParse([
        "buy",
        seller.toBase58(),
        mint.toBase58(),
        "--keypair",
        "agent.json",
      ]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(connection.sent).toHaveLength(1);
    const preview = harness.stderrLines.join("\n");
    expect(preview).toMatch(/preview/i);
    expect(preview).toMatch(/1 SOL/);
    expect(preview).toMatch(/0.99 SOL/);
    expect(preview).toMatch(/0.01 SOL/);
    expect(harness.stdoutLines.join("\n")).toContain(FAKE_SIGNATURE);
  });

  it("sends nothing when the user does not confirm", async () => {
    const { connection } = deployedWithListing(1_000_000_000n);
    const harness = makeDeps(connection, {
      keypair: agentKeypair,
      confirmAnswer: false,
    });
    const exit = await runCommand(
      mustParse([
        "buy",
        seller.toBase58(),
        mint.toBase58(),
        "--keypair",
        "agent.json",
      ]),
      harness.deps,
    );
    expect(exit).toBe(1);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses when the price changes between preview and confirmation", async () => {
    const listing = deriveListingAddress(seller, mint, "devnet");
    const accounts = new Map<string, Buffer>();
    accounts.set(
      listing.address.toBase58(),
      encodeListing(seller, mint, 1_000_000_000n, listing.bump),
    );
    const connection = createFakeConnection({
      programDeployed: true,
      accounts,
    });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    // The seller reprices while the user is reading the preview.
    harness.deps.confirm = async () => {
      accounts.set(
        listing.address.toBase58(),
        encodeListing(seller, mint, 2_000_000_000n, listing.bump),
      );
      return true;
    };
    await expect(
      runCommand(
        mustParse([
          "buy",
          seller.toBase58(),
          mint.toBase58(),
          "--keypair",
          "agent.json",
        ]),
        harness.deps,
      ),
    ).rejects.toThrow(/price changed/i);
    expect(connection.sent).toHaveLength(0);
    // The preview showed the old price; the refusal names the change.
    expect(harness.stderrLines.join("\n")).toMatch(/1 SOL/);
  });
});

describe("runCommand: cancel", () => {
  const seller = agentKeypair.publicKey;
  const mint = mintKeypair.publicKey;

  function deployedWithListing(price: bigint) {
    const listing = deriveListingAddress(seller, mint, "devnet");
    const accounts = new Map<string, Buffer>();
    accounts.set(
      listing.address.toBase58(),
      encodeListing(seller, mint, price, listing.bump),
    );
    return createFakeConnection({ programDeployed: true, accounts });
  }

  it("refuses with the not-deployed message while the program is missing", async () => {
    const connection = createFakeConnection();
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse(["cancel", mint.toBase58(), "--keypair", "agent.json"]),
        harness.deps,
      ),
    ).rejects.toThrow(/market program is not deployed on devnet yet/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("refuses when there is no listing for this wallet and mint", async () => {
    const connection = createFakeConnection({ programDeployed: true });
    const harness = makeDeps(connection, { keypair: agentKeypair });
    await expect(
      runCommand(
        mustParse(["cancel", mint.toBase58(), "--keypair", "agent.json"]),
        harness.deps,
      ),
    ).rejects.toThrow(/listing gone/i);
    expect(connection.sent).toHaveLength(0);
  });

  it("previews the listing and sends once deployed", async () => {
    const connection = deployedWithListing(500_000_000n);
    const harness = makeDeps(connection, { keypair: agentKeypair });
    const exit = await runCommand(
      mustParse(["cancel", mint.toBase58(), "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(0);
    expect(connection.sent).toHaveLength(1);
    const preview = harness.stderrLines.join("\n");
    expect(preview).toMatch(/preview/i);
    expect(preview).toContain(mint.toBase58());
    expect(preview).toMatch(/0.5 SOL/);
    expect(harness.stdoutLines.join("\n")).toContain(FAKE_SIGNATURE);
  });

  it("sends nothing when the user does not confirm", async () => {
    const connection = deployedWithListing(500_000_000n);
    const harness = makeDeps(connection, {
      keypair: agentKeypair,
      confirmAnswer: false,
    });
    const exit = await runCommand(
      mustParse(["cancel", mint.toBase58(), "--keypair", "agent.json"]),
      harness.deps,
    );
    expect(exit).toBe(1);
    expect(connection.sent).toHaveLength(0);
  });
});
