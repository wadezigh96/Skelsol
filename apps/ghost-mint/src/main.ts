import {
  activityLabel,
  buildMintTransaction,
  createPublicMarketConnection,
  createReaderLimitsChecker,
  explorerAddressUrl,
  explorerTransactionUrl,
  formatCount,
  getCollectionOverview,
  getMintLimits,
  getNetworkConfig,
  GHOST_COLLECTION,
  lookupWallet,
  marketStatsFromListings,
  readMarketState,
  setRpcEndpointOverride,
  shortenAddress,
  statsViewModel,
  timeAgo,
  toMarketConnection,
  toReaderConnection,
  WalletAdapter,
  withCause,
  withTimeout,
  type ActivityEvent,
  type BuildMintTransactionResult,
  type LeaderboardEntry,
  type MarketStats,
  type MintLimits,
  type Network,
  type ReaderTransaction,
  type WalletInscription,
} from "@skelsol/template";

import {
  formatCostLines,
  lookupSummary,
  mintAllowanceText,
} from "./view.js";
import { SITE_CONFIG } from "./site-config.js";

/**
 * Ghost Mint: the page wiring. Owns the DOM, the wallet adapter, and
 * the network switch; all display strings come from `view.ts` and the
 * template's UI kit, and all chain reads go through the template. No
 * logic worth unit-testing lives here: the pure parts are in
 * `view.ts` and the template.
 */

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Ghost Mint: missing element #${id}.`);
  }
  return found as T;
}

function clearChildren(node: HTMLElement): void {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
}

function explorerLink(
  text: string,
  href: string,
): HTMLAnchorElement {
  const link = document.createElement("a");
  link.textContent = text;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "skel-mono";
  return link;
}

function friendlyMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

// A dedicated RPC endpoint comes from the build (an environment
// variable at build time, never from the repo). Without it, the
// public endpoint is used. See ADR 0012.
if (SITE_CONFIG.devnetRpcUrl !== null) {
  setRpcEndpointOverride("devnet", SITE_CONFIG.devnetRpcUrl);
}

const adapter = new WalletAdapter();
let network: Network = adapter.network;
let pendingMint: BuildMintTransactionResult | null = null;
let refreshing = false;

/** How long a refresh may wait on the network before giving up honestly. */
const REFRESH_TIMEOUT_MS = 30_000;
/** How long the market read may wait before it is reported unreachable. */
const MARKET_TIMEOUT_MS = 15_000;

/**
 * One signature cache for the whole app session, shared by every
 * reader call. The reader fetches each transaction once and reuses it
 * across refreshes; only new signatures are fetched. Cleared on
 * network switch: the two networks have different transactions.
 */
const readerCache = new Map<string, ReaderTransaction | null>();

const walletButton = element<HTMLButtonElement>("wallet-button");
const walletPicker = element<HTMLElement>("wallet-picker");
const walletPickerList = element<HTMLElement>("wallet-picker-list");
const devnetButton = element<HTMLButtonElement>("network-devnet");
const mainnetButton = element<HTMLButtonElement>("network-mainnet");
const refreshButton = element<HTMLButtonElement>("refresh-button");
const statsStatus = element<HTMLElement>("stats-status");
const marketNoteStatus = element<HTMLElement>("market-note-status");
const statMinted = element<HTMLElement>("stat-minted");
const statMinters = element<HTMLElement>("stat-minters");
const statInscriptions = element<HTMLElement>("stat-inscriptions");
const statListings = element<HTMLElement>("stat-listings");
const statFloor = element<HTMLElement>("stat-floor");
const lookupInput = element<HTMLInputElement>("lookup-input");
const lookupButton = element<HTMLButtonElement>("lookup-button");
const lookupResult = element<HTMLElement>("lookup-result");
const mintAllowance = element<HTMLElement>("mint-allowance");
const mintButton = element<HTMLButtonElement>("mint-button");
const mintPreview = element<HTMLElement>("mint-preview");
const mintConfirmButton =
  element<HTMLButtonElement>("mint-confirm-button");
const mintStatus = element<HTMLElement>("mint-status");
const leaderboardBody = element<HTMLElement>("leaderboard-body");
const leaderboardEmpty = element<HTMLElement>("leaderboard-empty");
const activityList = element<HTMLElement>("activity-list");
const activityEmpty = element<HTMLElement>("activity-empty");

function readerConnection() {
  return toReaderConnection(adapter.getConnection());
}

async function refresh(): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  statsStatus.textContent = "Loading on-chain state…";
  try {
    const connection = readerConnection();
    // One scan for all three views (ADR 0011): the page used to run
    // three separate scans, and the memo window slides while they
    // run, so each scan fetched a mostly new set of transactions.
    const { state, leaderboard, activity } = await withTimeout(
      getCollectionOverview(connection, GHOST_COLLECTION, {
        cache: readerCache,
      }),
      REFRESH_TIMEOUT_MS,
      "The Solana network is slow right now: the page could not load " +
        "its numbers in time. Check your connection and try Refresh.",
    );

    // The market read is isolated: a market failure must not hide the
    // collection stats, which come from the reader and work regardless.
    // The market note is live, not static copy: it says whether the
    // market program is deployed on this network right now.
    let marketStats: MarketStats | undefined;
    try {
      const { deployed, listings } = await withTimeout(
        readMarketState(toMarketConnection(adapter.getConnection()), network, {
          // When the configured endpoint fails, the public endpoint
          // gets one try before the read gives up (ADR 0013).
          fallbackConnection: createPublicMarketConnection(network),
        }),
        MARKET_TIMEOUT_MS,
        "The market could not be reached in time.",
      );
      if (deployed) {
        marketStats = marketStatsFromListings(listings);
        marketNoteStatus.textContent = `The market is live on ${network}.`;
      } else {
        marketNoteStatus.textContent =
          `The market program is not deployed on ${network} yet.`;
      }
    } catch (error) {
      // Show the underlying cause when there is one ("…right now.
      // (429 Too Many Requests)"), so a failing market read says
      // WHAT failed instead of hiding it behind a generic note.
      marketNoteStatus.textContent = withCause(
        "Could not reach the market right now.",
        error,
      );
    }

    const stats = statsViewModel(state, marketStats);
    statMinted.textContent = stats.minted;
    statMinters.textContent = stats.minters;
    statInscriptions.textContent = stats.inscriptions;
    statListings.textContent = stats.listings;
    statFloor.textContent = stats.floor;
    renderLeaderboard(leaderboard);
    renderActivity(activity);
    // The reader survives rate limits by skipping failed fetches; say so
    // plainly instead of showing partial numbers as if they were complete.
    statsStatus.textContent =
      (state.failedFetches ?? 0) > 0
        ? `Some records could not be read (${state.failedFetches} of ` +
          `${state.scanned} failed). The numbers above may be incomplete — ` +
          `refresh to try again.`
        : "";
    await refreshAllowance();
  } catch (error) {
    statsStatus.textContent = friendlyMessage(error);
  } finally {
    refreshing = false;
  }
}

function renderLeaderboard(entries: LeaderboardEntry[]): void {
  clearChildren(leaderboardBody);
  leaderboardEmpty.hidden = entries.length > 0;
  entries.forEach((entry, index) => {
    const row = document.createElement("tr");
    const rank = document.createElement("td");
    rank.textContent = String(index + 1);
    const wallet = document.createElement("td");
    wallet.appendChild(
      explorerLink(
        shortenAddress(entry.wallet),
        explorerAddressUrl(entry.wallet, network),
      ),
    );
    const count = document.createElement("td");
    count.textContent = formatCount(entry.count);
    row.append(rank, wallet, count);
    leaderboardBody.appendChild(row);
  });
}

function renderActivity(events: ActivityEvent[]): void {
  clearChildren(activityList);
  activityEmpty.hidden = events.length > 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const event of events) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = activityLabel(event);
    const when = document.createElement("time");
    when.textContent = timeAgo(event.blockTime, nowSeconds);
    const link = explorerLink(
      "view",
      explorerTransactionUrl(event.signature, network),
    );
    item.append(label, when, link);
    activityList.appendChild(item);
  }
}

async function refreshAllowance(): Promise<void> {
  const publicKey = adapter.publicKey;
  if (publicKey === null) {
    mintAllowance.textContent = mintAllowanceText(null);
    mintButton.disabled = true;
    return;
  }
  try {
    const limits: MintLimits = await getMintLimits(
      readerConnection(),
      GHOST_COLLECTION,
      publicKey.toBase58(),
      { cache: readerCache },
    );
    mintAllowance.textContent = mintAllowanceText(limits);
    mintButton.disabled = !limits.canMint;
  } catch (error) {
    mintAllowance.textContent = friendlyMessage(error);
    mintButton.disabled = true;
  }
}

function updateWalletButton(): void {
  const publicKey = adapter.publicKey;
  if (publicKey === null) {
    walletButton.textContent = "Connect wallet";
    return;
  }
  const name = adapter.walletName ?? "Wallet";
  walletButton.textContent = `${name} · ${shortenAddress(publicKey.toBase58())}`;
}

async function connectWallet(walletName: string): Promise<void> {
  walletPicker.hidden = true;
  mintStatus.textContent = `Connecting to ${walletName}…`;
  try {
    await adapter.connect(walletName);
    updateWalletButton();
    mintStatus.textContent = "";
    await refreshAllowance();
  } catch (error) {
    mintStatus.textContent = friendlyMessage(error);
  }
}

function showWalletPicker(): void {
  const wallets = adapter.discoverWallets();
  if (wallets.length === 0) {
    mintStatus.textContent =
      "No Solana wallet is installed. Install Phantom, Solflare, or " +
      "Backpack, then try again.";
    return;
  }
  if (wallets.length === 1) {
    const only = wallets[0];
    if (only !== undefined) {
      void connectWallet(only.name);
    }
    return;
  }
  clearChildren(walletPickerList);
  for (const wallet of wallets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skel-btn skel-btn-ghost";
    button.textContent = wallet.name;
    button.addEventListener("click", () => {
      void connectWallet(wallet.name);
    });
    walletPickerList.appendChild(button);
  }
  walletPicker.hidden = false;
}

async function onWalletButton(): Promise<void> {
  if (adapter.connected) {
    await adapter.disconnect();
    pendingMint = null;
    mintPreview.hidden = true;
    mintConfirmButton.hidden = true;
    updateWalletButton();
    await refreshAllowance();
    return;
  }
  showWalletPicker();
}

async function onLookup(): Promise<void> {
  const address = lookupInput.value.trim();
  if (address.length === 0) {
    lookupResult.textContent = "Paste a wallet address first.";
    return;
  }
  lookupResult.textContent = "Looking up…";
  try {
    const inscriptions: WalletInscription[] = await lookupWallet(
      readerConnection(),
      GHOST_COLLECTION,
      address,
      { cache: readerCache },
    );
    clearChildren(lookupResult);
    const summary = document.createElement("p");
    summary.textContent = lookupSummary(
      GHOST_COLLECTION.tick,
      address,
      inscriptions.length,
    );
    lookupResult.appendChild(summary);
    if (inscriptions.length > 0) {
      const list = document.createElement("ul");
      list.className = "skel-activity";
      for (const inscription of inscriptions) {
        const item = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${GHOST_COLLECTION.tick} · ${shortenAddress(inscription.mint)}`;
        const link = explorerLink(
          "view",
          explorerTransactionUrl(inscription.signature, network),
        );
        item.append(label, link);
        list.appendChild(item);
      }
      lookupResult.appendChild(list);
    }
  } catch (error) {
    lookupResult.textContent = friendlyMessage(error);
  }
}

/** Step 1 of the mint flow: build the transaction, show the cost. */
async function onMint(): Promise<void> {
  const publicKey = adapter.publicKey;
  if (publicKey === null) {
    mintStatus.textContent = "Connect a wallet before minting.";
    return;
  }
  mintStatus.textContent = "Building your mint transaction…";
  mintPreview.hidden = true;
  mintConfirmButton.hidden = true;
  pendingMint = null;
  try {
    const result = await buildMintTransaction({
      collection: GHOST_COLLECTION,
      network: getNetworkConfig(network),
      wallet: publicKey,
      connection: adapter.getConnection(),
      limits: createReaderLimitsChecker(readerConnection()),
    });
    pendingMint = result;
    const lines = formatCostLines(result.cost);
    clearChildren(mintPreview);
    const heading = document.createElement("p");
    heading.textContent = `Preview: one ${GHOST_COLLECTION.tick} inscription + carrier NFT.`;
    const costs = document.createElement("p");
    costs.className = "skel-mono";
    costs.textContent =
      `Rent deposits ${lines.rent} · Mint price ${lines.price} · ` +
      `Network fee ${lines.fee} · Total ${lines.total}`;
    const note = document.createElement("p");
    note.className = "skel-note";
    note.textContent =
      "Rent deposits are refundable: they come back when the accounts " +
      "close. Nothing is sent until you confirm in your wallet.";
    mintPreview.append(heading, costs, note);
    mintPreview.hidden = false;
    mintConfirmButton.hidden = false;
    mintStatus.textContent = "";
  } catch (error) {
    mintStatus.textContent = friendlyMessage(error);
  }
}

/** Step 2 of the mint flow: sign in the wallet, send, show the link. */
async function onConfirmMint(): Promise<void> {
  const result = pendingMint;
  if (result === null) {
    return;
  }
  mintConfirmButton.hidden = true;
  mintStatus.textContent = "Confirm the transaction in your wallet…";
  try {
    const connection = adapter.getConnection();
    const signed = await adapter.signTransaction(result.transaction);
    signed.partialSign(result.mintKeypair);
    const signature = await connection.sendRawTransaction(
      signed.serialize(),
    );
    mintStatus.textContent = "Transaction sent. Waiting for confirmation…";
    await connection.confirmTransaction(signature, "confirmed");
    pendingMint = null;
    mintPreview.hidden = true;
    clearChildren(mintStatus);
    const done = document.createElement("p");
    done.textContent = "Minted! Your ghost inscription is on-chain.";
    const link = explorerLink(
      "View the transaction",
      explorerTransactionUrl(signature, network),
    );
    mintStatus.append(done, link);
    await refresh();
  } catch (error) {
    mintStatus.textContent = friendlyMessage(error);
  }
}

function switchNetwork(next: Network): void {
  if (next === network) {
    return;
  }
  network = next;
  adapter.setNetwork(next);
  devnetButton.setAttribute(
    "aria-pressed",
    String(next === "devnet"),
  );
  mainnetButton.setAttribute(
    "aria-pressed",
    String(next === "mainnet"),
  );
  // The cache holds the old network's transactions; start fresh.
  readerCache.clear();
  pendingMint = null;
  mintPreview.hidden = true;
  mintConfirmButton.hidden = true;
  mintStatus.textContent = "";
  lookupResult.textContent = "";
  void refresh();
}

// The graveyard scene is a looping video. Start it from here (not with
// the autoplay attribute) so visitors who prefer reduced motion get the
// still poster instead of a dancing video.
function startGraveyardVideo(): void {
  const video = document.querySelector(".skel-graveyard-art");
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  void video.play().catch(() => {
    // Autoplay was blocked; the poster still shows the scene.
  });
}

walletButton.addEventListener("click", () => {
  void onWalletButton();
});
devnetButton.addEventListener("click", () => switchNetwork("devnet"));
mainnetButton.addEventListener("click", () => switchNetwork("mainnet"));
refreshButton.addEventListener("click", () => {
  void refresh();
});
lookupButton.addEventListener("click", () => {
  void onLookup();
});
lookupInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    void onLookup();
  }
});
mintButton.addEventListener("click", () => {
  void onMint();
});
mintConfirmButton.addEventListener("click", () => {
  void onConfirmMint();
});

startGraveyardVideo();

void refresh();
