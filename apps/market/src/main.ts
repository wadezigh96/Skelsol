import { PublicKey, type Transaction } from "@solana/web3.js";
import {
  activityLabel,
  buildBuyTransaction,
  buildCancelTransaction,
  buildListTransaction,
  createPublicMarketConnection,
  explorerAddressUrl,
  explorerTransactionUrl,
  getCollectionOverview,
  GHOST_COLLECTION,
  lookupWallet,
  MarketError,
  readMarketState,
  setRpcEndpointOverride,
  shortenAddress,
  timeAgo,
  toMarketConnection,
  toReaderConnection,
  WalletAdapter,
  withCause,
  withTimeout,
  type ActivityEvent,
  type Listing,
  type Network,
  type ReaderTransaction,
  type WalletInscription,
} from "@skelsol/template";

import {
  emptyListingsText,
  listingRow,
  marketUnavailableText,
  parseSolPrice,
  salePreview,
  sellCandidates,
  sortListings,
  statsViewModel,
  type MarketAvailability,
  type SellCandidate,
} from "./view.js";
import { SITE_CONFIG } from "./site-config.js";

/**
 * Inscription Market: the page wiring. Owns the DOM, the wallet
 * adapter, and the network switch; all display strings come from
 * `view.ts` and the template's UI kit, and all chain reads and
 * transaction building go through the template. No logic worth
 * unit-testing lives here: the pure parts are in `view.ts` and the
 * template.
 *
 * The market transaction builders return transactions without a recent
 * blockhash (see market.ts), so every flow fetches the latest
 * blockhash and sets it before signing (see `signAndSend`).
 */

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Inscription Market: missing element #${id}.`);
  }
  return found as T;
}

function clearChildren(node: HTMLElement): void {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
}

function explorerLink(text: string, href: string): HTMLAnchorElement {
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
/** `"unknown"` while the market read has failed (RPC error), so the
 * page never misreports a network failure as a missing program. */
let marketAvailability: MarketAvailability | "unknown" = "unknown";
let marketLoadError: string | null = null;
let listings: Listing[] = [];
let ownedInscriptions: WalletInscription[] = [];
let ownedLoadError: string | null = null;
let selectedListing: Listing | null = null;
let pendingList: { mint: PublicKey; price: bigint } | null = null;
let pendingCancel: Listing | null = null;
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
const soundButton = element<HTMLButtonElement>("sound-button");
const horrorAudio = element<HTMLAudioElement>("horror-audio");
// Half volume: atmosphere, not a jumpscare.
horrorAudio.volume = 0.5;
const walletPicker = element<HTMLElement>("wallet-picker");
const walletPickerList = element<HTMLElement>("wallet-picker-list");
const devnetButton = element<HTMLButtonElement>("network-devnet");
const mainnetButton = element<HTMLButtonElement>("network-mainnet");
const refreshButton = element<HTMLButtonElement>("refresh-button");
const statsStatus = element<HTMLElement>("stats-status");
const statMinted = element<HTMLElement>("stat-minted");
const statMinters = element<HTMLElement>("stat-minters");
const statInscriptions = element<HTMLElement>("stat-inscriptions");
const statListings = element<HTMLElement>("stat-listings");
const statFloor = element<HTMLElement>("stat-floor");
const marketNote = element<HTMLElement>("market-note");
const listingsBody = element<HTMLElement>("listings-body");
const listingsEmpty = element<HTMLElement>("listings-empty");
const listingsNote = element<HTMLElement>("listings-note");
const cancelPreview = element<HTMLElement>("cancel-preview");
const cancelConfirmButton =
  element<HTMLButtonElement>("cancel-confirm-button");
const cancelStatus = element<HTMLElement>("cancel-status");
const buySelected = element<HTMLElement>("buy-selected");
const buyPreview = element<HTMLElement>("buy-preview");
const buyConfirmButton = element<HTMLButtonElement>("buy-confirm-button");
const buyStatus = element<HTMLElement>("buy-status");
const sellSelect = element<HTMLSelectElement>("sell-select");
const sellPriceInput = element<HTMLInputElement>("sell-price-input");
const sellButton = element<HTMLButtonElement>("sell-button");
const sellNote = element<HTMLElement>("sell-note");
const sellPreview = element<HTMLElement>("sell-preview");
const sellConfirmButton = element<HTMLButtonElement>("sell-confirm-button");
const sellStatus = element<HTMLElement>("sell-status");
const activityList = element<HTMLElement>("activity-list");
const activityEmpty = element<HTMLElement>("activity-empty");

function readerConnection() {
  return toReaderConnection(adapter.getConnection());
}

function marketConnection() {
  return toMarketConnection(adapter.getConnection());
}

/**
 * Fetch the latest blockhash, set it on the transaction, sign with the
 * connected wallet, send, and wait for confirmation. The market
 * builders do not set a blockhash themselves, so this step is
 * required for every market transaction.
 */
async function signAndSend(transaction: Transaction): Promise<string> {
  const connection = adapter.getConnection();
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  const signed = await adapter.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

function connectedWallet(): string | null {
  const publicKey = adapter.publicKey;
  return publicKey === null ? null : publicKey.toBase58();
}

async function refresh(): Promise<void> {
  if (refreshing) {
    return;
  }
  refreshing = true;
  statsStatus.textContent = "Loading on-chain state…";
  try {
    const connection = readerConnection();
    // One scan for both views (ADR 0011): the page used to run two
    // separate scans, and the memo window slides while they run, so
    // each scan fetched a mostly new set of transactions.
    const { state, activity } = await withTimeout(
      getCollectionOverview(connection, GHOST_COLLECTION, {
        cache: readerCache,
      }),
      REFRESH_TIMEOUT_MS,
      "The Solana network is slow right now: the page could not load " +
        "its numbers in time. Check your connection and try Refresh.",
    );
    renderActivity(activity);

    // The market read is isolated: a market failure must not hide the
    // collection stats, which come from the reader and work regardless.
    try {
      const { deployed, listings: open } = await withTimeout(
        readMarketState(marketConnection(), network, {
          // When the configured endpoint fails, the public endpoint
          // gets one try before the read gives up (ADR 0013).
          fallbackConnection: createPublicMarketConnection(network),
        }),
        MARKET_TIMEOUT_MS,
        "The market could not be reached in time.",
      );
      marketAvailability = deployed ? "deployed" : "not-deployed";
      listings = open;
      marketLoadError = null;
    } catch (error) {
      marketAvailability = "unknown";
      listings = [];
      // Show the underlying cause when there is one, so a failing
      // market read says WHAT failed instead of hiding it behind a
      // generic note.
      marketLoadError = withCause(friendlyMessage(error), error);
    }

    // A selected listing may have sold or been cancelled since it was
    // picked: drop it rather than offering a stale buy.
    const selected = selectedListing;
    if (
      selected !== null &&
      !listings.some((listing) => listing.address.equals(selected.address))
    ) {
      selectedListing = null;
      buyStatus.textContent =
        "The selected listing is no longer available. Pick another one from the table.";
    }
    const cancelling = pendingCancel;
    if (
      cancelling !== null &&
      !listings.some((listing) => listing.address.equals(cancelling.address))
    ) {
      pendingCancel = null;
      cancelPreview.hidden = true;
      cancelConfirmButton.hidden = true;
    }

    const availabilityForStats =
      marketAvailability === "unknown"
        ? "not-deployed"
        : marketAvailability;
    const stats = statsViewModel(state, availabilityForStats, listings);
    statMinted.textContent = stats.minted;
    statMinters.textContent = stats.minters;
    statInscriptions.textContent = stats.inscriptions;
    statListings.textContent = stats.listings;
    statFloor.textContent = stats.floor;

    // The stats note and the listings note always say the same thing.
    const marketNoteText =
      marketAvailability === "unknown"
        ? (marketLoadError ?? "")
        : marketAvailability === "not-deployed"
          ? marketUnavailableText(network)
          : "";
    marketNote.textContent = marketNoteText;
    listingsNote.textContent = marketNoteText;
    renderListings();
    renderBuySection();
    // The reader survives rate limits by skipping failed fetches; say so
    // plainly instead of showing partial numbers as if they were complete.
    // A mint that aged out of the live memo window still counts through
    // the collection registry (ADR 0015); say that plainly too.
    const failedNote =
      (state.failedFetches ?? 0) > 0
        ? `Some records could not be read (${state.failedFetches} of ` +
          `${state.scanned} failed). The numbers above may be incomplete — ` +
          `refresh to try again.`
        : "";
    const registryCount = state.fromRegistry ?? 0;
    const registryNote =
      registryCount > 0
        ? `Includes ${registryCount} verified inscription${registryCount === 1 ? "" : "s"} from the collection registry.`
        : "";
    statsStatus.textContent = [failedNote, registryNote]
      .filter((note) => note.length > 0)
      .join(" ");
    await refreshSellCandidates();
  } catch (error) {
    statsStatus.textContent = friendlyMessage(error);
  } finally {
    refreshing = false;
  }
}

function renderListings(): void {
  clearChildren(listingsBody);
  const wallet = connectedWallet();
  listingsEmpty.hidden =
    marketAvailability !== "deployed" || listings.length > 0;
  if (marketAvailability === "deployed" && listings.length === 0) {
    listingsEmpty.textContent = emptyListingsText();
  }
  for (const listing of sortListings(listings)) {
    const row = listingRow(listing, wallet);
    const tableRow = document.createElement("tr");

    const seller = document.createElement("td");
    seller.appendChild(
      explorerLink(
        row.seller,
        explorerAddressUrl(row.sellerAddress, network),
      ),
    );
    const mint = document.createElement("td");
    mint.appendChild(
      explorerLink(
        row.mint,
        explorerAddressUrl(row.mintAddress, network),
      ),
    );
    const amount = document.createElement("td");
    amount.textContent = row.amount;
    const price = document.createElement("td");
    price.textContent = row.price;
    const total = document.createElement("td");
    total.textContent = row.total;

    const action = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skel-btn skel-btn-ghost";
    if (row.isOwn) {
      button.textContent = "Cancel";
      button.addEventListener("click", () => {
        onSelectCancel(listing);
      });
    } else {
      button.textContent = "Buy";
      button.addEventListener("click", () => {
        onSelectBuy(listing);
      });
    }
    action.appendChild(button);

    tableRow.append(seller, mint, amount, price, total, action);
    listingsBody.appendChild(tableRow);
  }
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

function renderBuySection(): void {
  const listing = selectedListing;
  if (listing === null) {
    buySelected.textContent = "Pick a listing from the table above.";
    buyPreview.hidden = true;
    buyConfirmButton.hidden = true;
    return;
  }
  const row = listingRow(listing, connectedWallet());
  const preview = salePreview(listing.price);
  buySelected.textContent =
    `Selected: ${row.mint} from ${row.seller} · total ${row.total}.`;
  clearChildren(buyPreview);
  const heading = document.createElement("p");
  heading.textContent = `Preview: buy this inscription for ${preview.total}.`;
  const costs = document.createElement("p");
  costs.className = "skel-mono";
  costs.textContent =
    `Total ${preview.total} · Fee ${preview.fee} (1%) · ` +
    `Seller receives ${preview.sellerReceives}`;
  const note = document.createElement("p");
  note.className = "skel-note";
  note.textContent =
    "The listing is re-checked on-chain before your wallet is asked " +
    "to sign: if it is gone or its price changed since you previewed " +
    "it, the buy is refused instead of sending a transaction that " +
    "cannot land. Nothing is sent until you confirm in your wallet.";
  buyPreview.append(heading, costs, note);
  buyPreview.hidden = false;
  buyConfirmButton.hidden = false;
  buyConfirmButton.disabled = adapter.publicKey === null;
  if (adapter.publicKey === null) {
    buyStatus.textContent = "Connect a wallet to buy this listing.";
  }
}

function renderSellForm(): void {
  const wallet = connectedWallet();
  const candidates: SellCandidate[] =
    marketAvailability === "deployed"
      ? sellCandidates(ownedInscriptions, listings, wallet)
      : [];
  clearChildren(sellSelect);
  if (candidates.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No carrier NFTs to list";
    sellSelect.appendChild(option);
  }
  for (const candidate of candidates) {
    const option = document.createElement("option");
    option.value = candidate.mint;
    option.textContent = candidate.label;
    sellSelect.appendChild(option);
  }
  const canList =
    marketAvailability === "deployed" &&
    wallet !== null &&
    candidates.length > 0;
  sellSelect.disabled = !canList;
  sellPriceInput.disabled = !canList;
  sellButton.disabled = !canList;
  if (marketAvailability === "unknown") {
    sellNote.textContent = marketLoadError ?? "";
  } else if (marketAvailability === "not-deployed") {
    sellNote.textContent = marketUnavailableText(network);
  } else if (ownedLoadError !== null) {
    sellNote.textContent = ownedLoadError;
  } else if (wallet === null) {
    sellNote.textContent = "Connect a wallet to list one of your carrier NFTs.";
  } else if (ownedInscriptions.length === 0) {
    sellNote.textContent =
      "This wallet has minted no GHOST inscriptions yet. Mint one in " +
      "Ghost Mint first.";
  } else if (candidates.length === 0) {
    sellNote.textContent =
      "Every inscription this wallet minted is already listed.";
  } else {
    sellNote.textContent =
      "Listing moves the carrier NFT into escrow until it sells or you " +
      "cancel the listing.";
  }
}

async function refreshSellCandidates(): Promise<void> {
  const publicKey = adapter.publicKey;
  if (publicKey === null) {
    ownedInscriptions = [];
    ownedLoadError = null;
    renderSellForm();
    return;
  }
  try {
    // The reader attributes inscriptions from mint transactions only:
    // it does not track transfers, so an inscription this wallet
    // received (or sent on) by transfer may be missing (or still
    // listed) here. The list transaction itself fails on-chain if the
    // seller no longer holds the NFT.
    ownedInscriptions = await lookupWallet(
      readerConnection(),
      GHOST_COLLECTION,
      publicKey.toBase58(),
      { cache: readerCache },
    );
    ownedLoadError = null;
  } catch (error) {
    ownedInscriptions = [];
    ownedLoadError = friendlyMessage(error);
  }
  renderSellForm();
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
  buyStatus.textContent = `Connecting to ${walletName}…`;
  try {
    await adapter.connect(walletName);
    updateWalletButton();
    buyStatus.textContent = "";
    await refresh();
  } catch (error) {
    buyStatus.textContent = friendlyMessage(error);
  }
}

function showWalletPicker(): void {
  const wallets = adapter.discoverWallets();
  if (wallets.length === 0) {
    buyStatus.textContent =
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

function clearPendingFlows(): void {
  selectedListing = null;
  pendingList = null;
  pendingCancel = null;
  buyPreview.hidden = true;
  buyConfirmButton.hidden = true;
  sellPreview.hidden = true;
  sellConfirmButton.hidden = true;
  cancelPreview.hidden = true;
  cancelConfirmButton.hidden = true;
}

async function onWalletButton(): Promise<void> {
  if (adapter.connected) {
    await adapter.disconnect();
    clearPendingFlows();
    buyStatus.textContent = "";
    sellStatus.textContent = "";
    cancelStatus.textContent = "";
    updateWalletButton();
    await refresh();
    return;
  }
  showWalletPicker();
}

/** Step 1 of the buy flow: pick a listing, see the exact total. */
function onSelectBuy(listing: Listing): void {
  selectedListing = listing;
  buyStatus.textContent = "";
  renderBuySection();
}

/** Step 2 of the buy flow: re-read, sign in the wallet, send. */
async function onConfirmBuy(): Promise<void> {
  const listing = selectedListing;
  const buyer = adapter.publicKey;
  if (listing === null || buyer === null) {
    return;
  }
  buyConfirmButton.hidden = true;
  buyStatus.textContent = "Re-checking the listing, then asking your wallet to sign…";
  try {
    // buildBuyTransaction re-reads the listing and refuses when it is
    // gone; the previewed price is passed along, so it also refuses
    // when the stored price changed since the preview. Either way the
    // buyer never pays a price they did not see.
    const transaction = await buildBuyTransaction({
      network,
      connection: marketConnection(),
      buyer,
      seller: listing.seller,
      mint: listing.mint,
      expectedPriceLamports: listing.price,
    });
    const signature = await signAndSend(transaction);
    selectedListing = null;
    buyPreview.hidden = true;
    clearChildren(buyStatus);
    const done = document.createElement("p");
    done.textContent =
      "Bought! The carrier NFT is now in your wallet.";
    const link = explorerLink(
      "View the transaction",
      explorerTransactionUrl(signature, network),
    );
    buyStatus.append(done, link);
    await refresh();
  } catch (error) {
    buyStatus.textContent =
      error instanceof MarketError && error.reason === "price-changed"
        ? "The price changed since you previewed it. Check the current listing and try again."
        : friendlyMessage(error);
    await refresh();
  }
}

/** Step 1 of the sell flow: pick an owned NFT, set a price, preview. */
function onSell(): void {
  const seller = adapter.publicKey;
  if (seller === null) {
    sellStatus.textContent = "Connect a wallet before listing.";
    return;
  }
  const mint = sellSelect.value;
  if (mint === "") {
    sellStatus.textContent = "Pick a carrier NFT to list first.";
    return;
  }
  const parsed = parseSolPrice(sellPriceInput.value);
  if (!parsed.ok) {
    sellStatus.textContent = parsed.error;
    return;
  }
  pendingList = { mint: new PublicKey(mint), price: parsed.lamports };
  const preview = salePreview(parsed.lamports);
  sellStatus.textContent = "";
  clearChildren(sellPreview);
  const heading = document.createElement("p");
  heading.textContent =
    `Preview: list ${shortenAddress(mint)} for ${preview.total}.`;
  const costs = document.createElement("p");
  costs.className = "skel-mono";
  costs.textContent =
    `Price ${preview.total} · Fee on sale ${preview.fee} (1%) · ` +
    `You receive ${preview.sellerReceives}`;
  const note = document.createElement("p");
  note.className = "skel-note";
  note.textContent =
    "The carrier NFT moves into escrow when you list it. Nothing is " +
    "sent until you confirm in your wallet.";
  sellPreview.append(heading, costs, note);
  sellPreview.hidden = false;
  sellConfirmButton.hidden = false;
}

/** Step 2 of the sell flow: sign in the wallet, send, see the listing. */
async function onConfirmSell(): Promise<void> {
  const pending = pendingList;
  const seller = adapter.publicKey;
  if (pending === null || seller === null) {
    return;
  }
  sellConfirmButton.hidden = true;
  sellStatus.textContent = "Confirm the transaction in your wallet…";
  try {
    const transaction = buildListTransaction({
      network,
      seller,
      mint: pending.mint,
      price: pending.price,
    });
    const signature = await signAndSend(transaction);
    pendingList = null;
    sellPreview.hidden = true;
    sellPriceInput.value = "";
    clearChildren(sellStatus);
    const done = document.createElement("p");
    done.textContent =
      "Listed! Your inscription is on the market now.";
    const link = explorerLink(
      "View the transaction",
      explorerTransactionUrl(signature, network),
    );
    sellStatus.append(done, link);
    await refresh();
  } catch (error) {
    sellStatus.textContent = friendlyMessage(error);
  }
}

/** Step 1 of the cancel flow: pick an own listing, see what happens. */
function onSelectCancel(listing: Listing): void {
  pendingCancel = listing;
  cancelStatus.textContent = "";
  clearChildren(cancelPreview);
  const heading = document.createElement("p");
  heading.textContent =
    `Cancel the listing for ${shortenAddress(listing.mint.toBase58())}?`;
  const note = document.createElement("p");
  note.className = "skel-note";
  note.textContent =
    "The carrier NFT returns to your wallet and the listing closes. " +
    "Nothing is sent until you confirm in your wallet.";
  cancelPreview.append(heading, note);
  cancelPreview.hidden = false;
  cancelConfirmButton.hidden = false;
}

/** Step 2 of the cancel flow: sign in the wallet, send, get the NFT back. */
async function onConfirmCancel(): Promise<void> {
  const listing = pendingCancel;
  const seller = adapter.publicKey;
  if (listing === null || seller === null) {
    return;
  }
  cancelConfirmButton.hidden = true;
  cancelStatus.textContent = "Confirm the transaction in your wallet…";
  try {
    const transaction = buildCancelTransaction({
      network,
      seller,
      mint: listing.mint,
    });
    const signature = await signAndSend(transaction);
    pendingCancel = null;
    cancelPreview.hidden = true;
    clearChildren(cancelStatus);
    const done = document.createElement("p");
    done.textContent =
      "Cancelled! The carrier NFT is back in your wallet.";
    const link = explorerLink(
      "View the transaction",
      explorerTransactionUrl(signature, network),
    );
    cancelStatus.append(done, link);
    await refresh();
  } catch (error) {
    cancelStatus.textContent = friendlyMessage(error);
  }
}

function switchNetwork(next: Network): void {
  if (next === network) {
    return;
  }
  network = next;
  adapter.setNetwork(next);
  devnetButton.setAttribute("aria-pressed", String(next === "devnet"));
  mainnetButton.setAttribute("aria-pressed", String(next === "mainnet"));
  clearPendingFlows();
  // The cache holds the old network's transactions; start fresh.
  readerCache.clear();
  marketAvailability = "unknown";
  marketLoadError = null;
  listings = [];
  ownedInscriptions = [];
  buyStatus.textContent = "";
  sellStatus.textContent = "";
  cancelStatus.textContent = "";
  void refresh();
}

// Horror ambience: browsers block sound autoplay, so the music only
// starts when the visitor taps the sound button. Off by default,
// loops quietly at half volume once on.
function onSoundButton(): void {
  if (horrorAudio.paused) {
    soundButton.setAttribute("aria-pressed", "true");
    soundButton.textContent = "Sound on";
    void horrorAudio.play().catch(() => {
      // Playback was blocked; the button goes back to off.
      soundButton.setAttribute("aria-pressed", "false");
      soundButton.textContent = "Sound off";
    });
  } else {
    horrorAudio.pause();
    soundButton.setAttribute("aria-pressed", "false");
    soundButton.textContent = "Sound off";
  }
}

walletButton.addEventListener("click", () => {
  void onWalletButton();
});
soundButton.addEventListener("click", () => {
  onSoundButton();
});
devnetButton.addEventListener("click", () => switchNetwork("devnet"));
mainnetButton.addEventListener("click", () => switchNetwork("mainnet"));
refreshButton.addEventListener("click", () => {
  void refresh();
});
buyConfirmButton.addEventListener("click", () => {
  void onConfirmBuy();
});
sellButton.addEventListener("click", () => {
  onSell();
});
sellPriceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    onSell();
  }
});
sellSelect.addEventListener("change", () => {
  pendingList = null;
  sellPreview.hidden = true;
  sellConfirmButton.hidden = true;
});
sellConfirmButton.addEventListener("click", () => {
  void onConfirmSell();
});
cancelConfirmButton.addEventListener("click", () => {
  void onConfirmCancel();
});

void refresh();
