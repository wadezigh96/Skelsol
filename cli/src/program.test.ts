import type {
  MarketConnection,
  MarketProgramAccount,
  MarketProgramAccountsConfig,
} from "@skelsol/template";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { CliError } from "./args.js";
import {
  assertMarketProgramDeployed,
  isMarketProgramDeployed,
  ProgramNotDeployedError,
} from "./program.js";

const PROGRAM_ID = new PublicKey(
  "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
);

function fakeConnection(
  account: { data: Buffer } | null | Error,
): MarketConnection & { queried: PublicKey[] } {
  const queried: PublicKey[] = [];
  return {
    queried,
    async getProgramAccounts(
      _programId: PublicKey,
      _config?: MarketProgramAccountsConfig,
    ): Promise<readonly MarketProgramAccount[]> {
      return [];
    },
    async getAccountInfo(pubkey: PublicKey) {
      queried.push(pubkey);
      if (account instanceof Error) {
        throw account;
      }
      return account;
    },
  };
}

describe("isMarketProgramDeployed", () => {
  it("returns true when the program account exists on devnet", async () => {
    const connection = fakeConnection({ data: Buffer.alloc(10) });
    await expect(
      isMarketProgramDeployed(connection, "devnet"),
    ).resolves.toBe(true);
    expect(connection.queried).toHaveLength(1);
    expect(connection.queried[0]?.toBase58()).toBe(PROGRAM_ID.toBase58());
  });

  it("returns false when the program account is missing (devnet deploy pending)", async () => {
    const connection = fakeConnection(null);
    await expect(
      isMarketProgramDeployed(connection, "devnet"),
    ).resolves.toBe(false);
  });

  it("returns false on mainnet, where no program ID is configured", async () => {
    const connection = fakeConnection({ data: Buffer.alloc(10) });
    await expect(
      isMarketProgramDeployed(connection, "mainnet"),
    ).resolves.toBe(false);
    expect(connection.queried).toHaveLength(0);
  });

  it("reports an RPC failure instead of pretending the program is missing", async () => {
    const connection = fakeConnection(new Error("fetch failed"));
    await expect(
      isMarketProgramDeployed(connection, "devnet"),
    ).rejects.toThrow(CliError);
    await expect(
      isMarketProgramDeployed(connection, "devnet"),
    ).rejects.toThrow(/could not reach the network/i);
  });
});

describe("assertMarketProgramDeployed", () => {
  it("returns the program ID when the program exists", async () => {
    const connection = fakeConnection({ data: Buffer.alloc(10) });
    await expect(
      assertMarketProgramDeployed(connection, "devnet"),
    ).resolves.toBe(PROGRAM_ID.toBase58());
  });

  it("refuses with the not-deployed message when the program account is missing", async () => {
    const connection = fakeConnection(null);
    await expect(
      assertMarketProgramDeployed(connection, "devnet"),
    ).rejects.toThrow(ProgramNotDeployedError);
    await expect(
      assertMarketProgramDeployed(connection, "devnet"),
    ).rejects.toThrow(
      /market program is not deployed on devnet yet/i,
    );
  });

  it("refuses with the not-deployed message on mainnet", async () => {
    const connection = fakeConnection({ data: Buffer.alloc(10) });
    await expect(
      assertMarketProgramDeployed(connection, "mainnet"),
    ).rejects.toThrow(
      /market program is not deployed on mainnet yet/i,
    );
  });
});
