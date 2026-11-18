import { describe, expect, it } from "vitest";

import {
  CliError,
  helpText,
  isHelpRequest,
  parseArgs,
} from "./args.js";

describe("parseArgs", () => {
  it("parses a bare command with devnet as the default network", () => {
    const parsed = parseArgs(["status"]);
    expect(isHelpRequest(parsed)).toBe(false);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.command).toBe("status");
    expect(parsed.network).toBe("devnet");
    expect(parsed.json).toBe(false);
    expect(parsed.keypairPath).toBeNull();
    expect(parsed.args).toEqual([]);
  });

  it("parses every command", () => {
    const cases: Array<{ argv: string[]; command: string }> = [
      { argv: ["status"], command: "status" },
      { argv: ["mint"], command: "mint" },
      {
        argv: ["list", "11111111111111111111111111111111", "1000"],
        command: "list",
      },
      {
        argv: [
          "buy",
          "11111111111111111111111111111111",
          "11111111111111111111111111111111",
        ],
        command: "buy",
      },
      { argv: ["cancel", "11111111111111111111111111111111"], command: "cancel" },
      { argv: ["lookup", "11111111111111111111111111111111"], command: "lookup" },
    ];
    for (const entry of cases) {
      const parsed = parseArgs(entry.argv);
      if (isHelpRequest(parsed)) {
        throw new Error(`expected a parsed command for ${entry.command}`);
      }
      expect(parsed.command).toBe(entry.command);
    }
  });

  it("parses --network mainnet and --json", () => {
    const parsed = parseArgs(["status", "--network", "mainnet", "--json"]);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.network).toBe("mainnet");
    expect(parsed.json).toBe(true);
  });

  it("parses --network=devnet and --keypair=path forms", () => {
    const parsed = parseArgs([
      "mint",
      "--network=devnet",
      "--keypair=/tmp/agent-keypair.json",
    ]);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.network).toBe("devnet");
    expect(parsed.keypairPath).toBe("/tmp/agent-keypair.json");
  });

  it("parses --keypair <path> with a separate value", () => {
    const parsed = parseArgs(["mint", "--keypair", "agent.json"]);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.keypairPath).toBe("agent.json");
  });

  it("accepts flags before the command too", () => {
    const parsed = parseArgs(["--json", "--network", "mainnet", "status"]);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.command).toBe("status");
    expect(parsed.network).toBe("mainnet");
    expect(parsed.json).toBe(true);
  });

  it("parses the list price as bigint lamports", () => {
    const parsed = parseArgs([
      "list",
      "11111111111111111111111111111111",
      "1500000000",
    ]);
    if (isHelpRequest(parsed)) {
      throw new Error("expected a parsed command, got a help request");
    }
    expect(parsed.priceLamports).toBe(1500000000n);
  });

  it("rejects an unknown command with a clear error", () => {
    expect(() => parseArgs(["dance"])).toThrow(CliError);
    expect(() => parseArgs(["dance"])).toThrow(/unknown command "dance"/i);
  });

  it("rejects an unknown flag with a clear error", () => {
    expect(() => parseArgs(["status", "--yes"])).toThrow(CliError);
    expect(() => parseArgs(["status", "--yes"])).toThrow(/unknown flag "--yes"/i);
  });

  it("rejects an unknown network with a clear error", () => {
    expect(() => parseArgs(["status", "--network", "testnet"])).toThrow(
      /unknown network "testnet"/i,
    );
  });

  it("rejects a missing --network value", () => {
    expect(() => parseArgs(["status", "--network"])).toThrow(
      /--network needs a value/i,
    );
  });

  it("rejects a missing --keypair value", () => {
    expect(() => parseArgs(["mint", "--keypair"])).toThrow(
      /--keypair needs a value/i,
    );
  });

  it("rejects a missing command", () => {
    expect(() => parseArgs([])).toThrow(CliError);
    expect(() => parseArgs([])).toThrow(/no command given/i);
  });

  it("rejects a second command word", () => {
    expect(() => parseArgs(["status", "mint"])).toThrow(
      /unexpected argument "mint"/i,
    );
  });

  it("rejects the wrong number of arguments per command", () => {
    expect(() => parseArgs(["status", "extra"])).toThrow(/takes no arguments/i);
    expect(() => parseArgs(["mint", "extra"])).toThrow(/takes no arguments/i);
    expect(() => parseArgs(["list", "only-one"])).toThrow(
      /"list" takes a mint address and a price/i,
    );
    expect(() => parseArgs(["buy", "only-one"])).toThrow(
      /"buy" takes a seller address and a mint address/i,
    );
    expect(() => parseArgs(["cancel"])).toThrow(
      /"cancel" takes a mint address/i,
    );
    expect(() => parseArgs(["lookup"])).toThrow(
      /"lookup" takes a wallet address/i,
    );
  });

  it("rejects a non-integer list price", () => {
    expect(() =>
      parseArgs(["list", "11111111111111111111111111111111", "1.5"]),
    ).toThrow(/price must be a whole number of lamports/i);
    expect(() =>
      parseArgs(["list", "11111111111111111111111111111111", "-5"]),
    ).toThrow(/price must be a whole number of lamports/i);
    expect(() =>
      parseArgs(["list", "11111111111111111111111111111111", "free"]),
    ).toThrow(/price must be a whole number of lamports/i);
  });

  it("returns a help request for --help, -h, help, and help <command>", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true, command: null });
    expect(parseArgs(["-h"])).toEqual({ help: true, command: null });
    expect(parseArgs(["help"])).toEqual({ help: true, command: null });
    expect(parseArgs(["status", "--help"])).toEqual({
      help: true,
      command: "status",
    });
    expect(parseArgs(["help", "mint"])).toEqual({
      help: true,
      command: "mint",
    });
    expect(() => parseArgs(["help", "dance"])).toThrow(
      /unknown command "dance"/i,
    );
  });
});

describe("helpText", () => {
  it("lists every command and flag", () => {
    const text = helpText(null);
    for (const word of [
      "status",
      "mint",
      "list",
      "buy",
      "cancel",
      "lookup",
      "--network",
      "--json",
      "--keypair",
    ]) {
      expect(text).toContain(word);
    }
  });

  it("warns about keypair safety", () => {
    const text = helpText(null);
    expect(text).toMatch(/never commit a keypair/i);
    expect(text).toMatch(/never use a keypair holding large funds/i);
    expect(text).toMatch(/dedicated low-value agent wallet/i);
  });

  it("explains the preview-before-send safety rule", () => {
    const text = helpText(null);
    expect(text).toMatch(/preview/i);
    expect(text).toMatch(/confirm/i);
  });

  it("gives per-command help with usage and an example", () => {
    const text = helpText("list");
    expect(text).toContain("skel list");
    expect(text).toMatch(/price/i);
    expect(text).toMatch(/lamports/i);
  });
});
