import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_NETWORK,
  GHOST_COLLECTION,
  clearRpcEndpointOverrides,
  getDefaultRpcEndpoint,
  getEscrowProgramId,
  getNetworkConfig,
  loadCollectionConfig,
  setRpcEndpointOverride,
} from "./config.js";

describe("loadCollectionConfig", () => {
  it("loads a valid collection config", () => {
    const config = loadCollectionConfig({
      tick: "GHOST",
      name: "Spooky Ghosts",
      supply: 4444,
      perWalletLimit: 4,
      priceLamports: 0,
      image: "https://example.com/skelsol/ghost.png",
      metadataBaseUri: "https://example.com/skelsol/ghost/",
    });

    expect(config).toEqual({
      tick: "GHOST",
      name: "Spooky Ghosts",
      supply: 4444,
      perWalletLimit: 4,
      priceLamports: 0,
      image: "https://example.com/skelsol/ghost.png",
      metadataBaseUri: "https://example.com/skelsol/ghost/",
    });
  });

  it("rejects a config with a missing tick", () => {
    expect(() =>
      loadCollectionConfig({
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/tick/);
  });

  it("rejects a config with an empty tick", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/tick/);
  });

  it("rejects a tick with lowercase or special characters", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "ghost!",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/tick/);
  });

  it("rejects a config with a missing name", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/name/);
  });

  it("rejects a config with a non-positive supply", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 0,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/supply/);
  });

  it("rejects a config with a non-integer supply", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 44.5,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/supply/);
  });

  it("rejects a config with a non-positive per-wallet limit", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 0,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/perWalletLimit/);
  });

  it("rejects a config with a negative price", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: -1,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/priceLamports/);
  });

  it("loads a priced config with a treasury address", () => {
    const config = loadCollectionConfig({
      tick: "GHOST",
      name: "Spooky Ghosts",
      supply: 4444,
      perWalletLimit: 4,
      priceLamports: 5000,
      treasury: "11111111111111111111111111111111",
      image: "https://example.com/skelsol/ghost.png",
      metadataBaseUri: "https://example.com/skelsol/ghost/",
    });

    expect(config.priceLamports).toBe(5000);
    expect(config.treasury).toBe("11111111111111111111111111111111");
  });

  it("rejects a priced config with no treasury to pay", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 5000,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/treasury/);
  });

  it("rejects a config with a malformed treasury address", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 5000,
        treasury: "not-an-address",
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/treasury/);
  });

  it("rejects a config with a bad image URL", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "not-a-url",
        metadataBaseUri: "https://example.com/skelsol/ghost/",
      }),
    ).toThrowError(/image/);
  });

  it("rejects a config with a bad metadata base URI", () => {
    expect(() =>
      loadCollectionConfig({
        tick: "GHOST",
        name: "Spooky Ghosts",
        supply: 4444,
        perWalletLimit: 4,
        priceLamports: 0,
        image: "https://example.com/skelsol/ghost.png",
        metadataBaseUri: "not-a-url",
      }),
    ).toThrowError(/metadataBaseUri/);
  });

  it("rejects input that is not an object", () => {
    expect(() => loadCollectionConfig("GHOST")).toThrowError(
      /collection config must be an object/,
    );
    expect(() => loadCollectionConfig(null)).toThrowError(
      /collection config must be an object/,
    );
  });
});

describe("GHOST_COLLECTION", () => {
  it("ships the Ghost collection: tick GHOST, supply 4444, 4 per wallet, free mint", () => {
    expect(GHOST_COLLECTION.tick).toBe("GHOST");
    expect(GHOST_COLLECTION.name).toBe("Spooky Ghosts");
    expect(GHOST_COLLECTION.supply).toBe(4444);
    expect(GHOST_COLLECTION.perWalletLimit).toBe(4);
    expect(GHOST_COLLECTION.priceLamports).toBe(0);
  });
});

describe("getNetworkConfig", () => {
  it("returns the devnet RPC endpoint and program IDs", () => {
    const config = getNetworkConfig("devnet");

    expect(config.network).toBe("devnet");
    expect(config.rpcEndpoint).toBe("https://api.devnet.solana.com");
    expect(config.memoProgramId).toBe(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    expect(config.tokenMetadataProgramId).toBe(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    );
  });

  it("returns the mainnet RPC endpoint and program IDs", () => {
    const config = getNetworkConfig("mainnet");

    expect(config.network).toBe("mainnet");
    expect(config.rpcEndpoint).toBe("https://api.mainnet.solana.com");
    expect(config.memoProgramId).toBe(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    expect(config.tokenMetadataProgramId).toBe(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    );
  });

  it("rejects an unknown network with a clear error", () => {
    expect(() =>
      getNetworkConfig("testnet" as "devnet"),
    ).toThrowError(/unknown network "testnet"/);
  });
});

describe("RPC endpoint overrides", () => {
  afterEach(() => {
    clearRpcEndpointOverrides();
  });

  it("uses the override endpoint for the network it was set on", () => {
    setRpcEndpointOverride(
      "devnet",
      "https://devnet.helius-rpc.com/?api-key=test-key",
    );

    expect(getNetworkConfig("devnet").rpcEndpoint).toBe(
      "https://devnet.helius-rpc.com/?api-key=test-key",
    );
    // The other network is untouched.
    expect(getNetworkConfig("mainnet").rpcEndpoint).toBe(
      "https://api.mainnet.solana.com",
    );
  });

  it("keeps the rest of the network config when overriding", () => {
    setRpcEndpointOverride("devnet", "https://example.com/rpc");

    const config = getNetworkConfig("devnet");
    expect(config.network).toBe("devnet");
    expect(config.escrowProgramId).toBe(
      "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
    );
    expect(config.memoProgramId).toBe(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
  });

  it("rejects an override that is not a URL", () => {
    expect(() =>
      setRpcEndpointOverride("devnet", "not a url"),
    ).toThrowError(/not a URL/);
    expect(getNetworkConfig("devnet").rpcEndpoint).toBe(
      "https://api.devnet.solana.com",
    );
  });

  it("rejects an override that is not http(s)", () => {
    expect(() =>
      setRpcEndpointOverride("devnet", "ws://example.com/rpc"),
    ).toThrowError(/http/);
  });

  it("restores the public endpoint when overrides are cleared", () => {
    setRpcEndpointOverride("devnet", "https://example.com/rpc");
    clearRpcEndpointOverrides();

    expect(getNetworkConfig("devnet").rpcEndpoint).toBe(
      "https://api.devnet.solana.com",
    );
  });
});

describe("getDefaultRpcEndpoint", () => {
  afterEach(() => {
    clearRpcEndpointOverrides();
  });

  it("returns the public endpoint for the network", () => {
    expect(getDefaultRpcEndpoint("devnet")).toBe(
      "https://api.devnet.solana.com",
    );
    expect(getDefaultRpcEndpoint("mainnet")).toBe(
      "https://api.mainnet.solana.com",
    );
  });

  it("ignores an endpoint override, so it stays usable as a fallback", () => {
    setRpcEndpointOverride(
      "devnet",
      "https://devnet.helius-rpc.com/?api-key=test-key",
    );

    expect(getDefaultRpcEndpoint("devnet")).toBe(
      "https://api.devnet.solana.com",
    );
  });

  it("rejects an unknown network with a clear error", () => {
    expect(() =>
      getDefaultRpcEndpoint("testnet" as "devnet"),
    ).toThrowError(/unknown network "testnet"/);
  });
});

describe("DEFAULT_NETWORK", () => {
  it("is devnet, so the demo apps and CLI try everything for free", () => {
    expect(DEFAULT_NETWORK).toBe("devnet");
  });
});

describe("escrow program ID", () => {
  it("is the real devnet program ID from ticket 07", () => {
    expect(getNetworkConfig("devnet").escrowProgramId).toBe(
      "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
    );
    expect(getEscrowProgramId("devnet")).toBe(
      "3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo",
    );
  });

  it("is an explicit placeholder (null) on mainnet until the owner deploys it", () => {
    expect(getNetworkConfig("mainnet").escrowProgramId).toBeNull();
  });

  it("fails clearly when code asks for the mainnet escrow program ID while it is a placeholder", () => {
    expect(() => getEscrowProgramId("mainnet")).toThrowError(
      /escrow program is not deployed on mainnet yet/,
    );
  });
});
