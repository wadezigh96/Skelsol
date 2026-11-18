# Skelsol — Devpost submission draft (Kiroween 2026)

> **This file is a draft for the owner to paste into Devpost.** Items
> marked **TODO (owner)** are things only the owner can provide and
> must not be invented: the demo video, the "How Kiro was used"
> write-up, and the deployed demo links (until the apps are hosted).
> Everything else in this draft is written from the repo as it stands
> on 19 November 2026. Before submitting, re-check the deploy status
> in `docs/DEPLOY.md` — if the market program has deployed by then,
> update the status lines below to match.

## Project title

**Skelsol**

## Tagline

A lean template for minting SPL-20-style inscriptions on Solana —
one skeleton, two apps, and a CLI for AI agents.

## Category

**Skeleton Crew** — one lean code template, shown through two distinct
applications (Ghost Mint and the Inscription Market), plus a third
consumer, the `skel` CLI for AI agents.

## Links

| | |
|---|---|
| Repository | https://github.com/wadezigh96/Skelsol |
| Ghost Mint (demo) | TODO (owner) — app not hosted yet; builds to a static site from `apps/ghost-mint/` |
| Inscription Market (demo) | TODO (owner) — app not hosted yet; builds to a static site from `apps/market/` |
| Demo video (under 3 minutes) | TODO (owner) — to be recorded by the owner; see "Demo video" below |
| Hackathon | https://kiroween.devpost.com |

## Description

### Inspiration

Inscription minting on Solana is fragmented: a creator who wants to
launch an inscription collection must wire together the SPL-20 JSON
convention, the on-chain write, an NFT carrier, a mint page, and (if
they want trading) a marketplace, each from scratch. There is no small,
honest, reusable starting point — and the existing inscription tooling
is hard for a newcomer to try without spending real money.

Skelsol takes its shape from Spooky B-Agents, a BSC inscription game
played by AI agents: a mint page with live stats, a leaderboard, and a
market — plus a CLI so agents can play without a browser. Skelsol
rebuilds that shape on Solana as a reusable template, with all-new code
and all-new art, and with the honesty the original never needed to
write down: what is an on-chain guarantee, and what is a convention.

### What it does

Skelsol is one lean template that a creator configures (ticker, supply,
price, image) and gets:

- **A mint client** that writes an SPL-20-style inscription — a JSON
  record in the `{"p":"spl-20","op":"mint","tick":"...","amt":"..."}`
  shape — into the memo of a Solana transaction, and mints a Metaplex
  NFT as the inscription's carrier. One mint, one inscription, one
  carrier NFT.
- **A reader** that rebuilds collection state (minted, minters,
  leaderboard, live activity) from on-chain records.
- **Two working web applications** built from the template:
  **Ghost Mint** (mint ghost inscriptions, live stats, wallet lookup,
  minter leaderboard, live activity) and the **Inscription Market**
  (list, buy, and cancel inscription sales at fixed prices, with the
  NFT held in on-chain escrow until it is bought or cancelled).
- **A CLI (`skel`)** so AI agents can use the same template from a
  terminal: `status`, `mint`, `list`, `buy`, `cancel`, `lookup`, with
  `--json` output and a local keypair wallet. A manual for agents
  (`agent.md`) ships at the repo root.
- **A minimal Anchor escrow program** (`skelsol-market`) so the market
  trades without trust: buy pays 99% to the seller and 1% to the
  treasury in one atomic transaction; only the seller can cancel.

The demo collection is **GHOST** ("Spooky Ghosts"): supply 4,444,
4 inscriptions per wallet, free mint (rent deposits only). Both demo
apps and the CLI default to **devnet**, so anyone can try the whole
flow for free; a network switch moves each app to mainnet.

### How it was built

- **TypeScript everywhere.** The template library is UI-free so the
  web apps and the CLI share one implementation. Tests run with
  vitest; the apps compile with `tsc` to static sites (no server, no
  database — all state is on-chain).
- **Inscriptions via the Memo program.** The JSON is written with a
  Memo v3 instruction in the mint transaction; the carrier is a
  Metaplex Token Metadata NFT minted with the Umi SDK. No custom mint
  program — minting needs no deploy and no audit. The choice of Token
  Metadata over Core is deliberate (every wallet, explorer, and
  marketplace reads it) and recorded in ADR 0002.
- **Escrow with Anchor 1.2.2.** The market program follows the
  canonical make/take/refund escrow pattern, adapted to a fixed-price
  NFT-for-SOL sale with a 1% fee. Its TypeScript client builds the
  `list` / `buy` / `cancel` instructions by hand from the committed
  IDL, because there is no Anchor 1.x TypeScript client on npm (ADR
  0010). The program is tested with 8 in-process LiteSVM tests, all
  passing.
- **Wallet Standard** for browser wallet connection (Phantom,
  Solflare), with legacy/v0 transactions so Ledger signing keeps
  working.
- **Design from primary-source research.** Before building, the
  project researched LibrePlex SPL-20, the Memo program, Metaplex
  Token Metadata, the Anchor escrow pattern, and devnet in the
  official docs and source code (`docs/research-solana-inscriptions.md`).
  That research is why the project says "SPL-20-style" and documents
  its limits honestly instead of claiming to implement LibrePlex
  SPL-20.
- **Spec-driven, in Kiro.** Requirements, design, and tasks live in
  `.kiro/specs/skelsol/`; decisions live in `docs/adr/` (10 ADRs).

### Challenges

- **There is no SPL-20 spec.** Research found no published
  specification from LibrePlex, no maintained reference in 2026, and
  that real LibrePlex inscriptions live in program-owned accounts,
  not in memos. The honest answer was to label the project
  "SPL-20-style", document the memo↔NFT binding as a convention the
  chain does not enforce, and say plainly that no existing SPL-20
  indexer will recognize these inscriptions.
- **The devnet faucet is closed to scripts.** `solana airdrop`
  against the public RPC fails, and the public RPC faucet returns
  "closed" — so funding (for the deploy wallet and for judges) goes
  through the web faucet instead, and the docs say so.
- **No Anchor 1.x TypeScript client.** The escrow program is built
  with Anchor 1.2.2, but npm has no matching TypeScript client, so
  the market client encodes instructions and decodes `Listing`
  accounts by hand, with tests pinning the discriminators to the IDL.
- **Rent is a moving target.** SIMD-0437 is cutting rent in steps
  through late 2026, so no rent figure is hard-coded anywhere; the
  mint client queries the live rent minimum at runtime.
- **No browser in the build environment.** The wallet handshake and a
  live mint in a real browser could not be tested here; a real-browser
  check with Phantom/Solflare is still needed before demo day, and
  the README says so.

### What's next

- **Deploy the market program to devnet** (funding the deploy wallet
  with ~3 SOL is the only blocker) and host both demo apps, so judges
  can try list/buy/cancel without running anything locally.
- **Host real collection art** (the config currently points at a
  placeholder image URL) and the off-chain metadata JSON on durable
  storage (Arweave/IPFS).
- **A real-browser test pass** with Phantom and Solflare, and a
  re-check of the demo flow after the deploy lands.
- **Metaplex Core migration path** for lower mint cost if the
  compatibility trade-off ever flips (documented in ADR 0002).
- **On-chain inscription accounts** (LibrePlex or Metaplex
  `mpl-inscription`) if a future feature ever needs a program to read
  inscription content — memo data cannot be read on-chain.

## Current status (19 November 2026 — update before submitting)

- **Minting works on devnet today**, verified live via `skel status`.
  It needs no custom program.
- **The market program is built and tested but NOT deployed yet.**
  The devnet deploy is waiting on ~3 SOL of funding for the deploy
  wallet `7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7` (web faucet:
  https://faucet.solana.com). Program ID:
  `3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo`. Until it deploys,
  listing, buying, and cancelling refuse with a clear message in both
  apps and in the CLI. See `docs/DEPLOY.md`.
- **The demo apps are not hosted yet.** They build to static sites
  (`apps/ghost-mint/dist/`, `apps/market/dist/`) and can be served
  from any static host, or run locally — see the judge instructions
  below.
- **The wallet handshake and live mint in a real browser have not
  been tested here** (no browser extension in this environment). A
  real-browser check is still needed before demo day.

## Judge testing instructions

Everything below is free on devnet. You need a Solana wallet
(Phantom or Solflare) in a real browser for the web apps, and Node.js
18+ for the CLI.

### 1. Get free devnet SOL

1. Open https://faucet.solana.com in your browser.
2. Paste your wallet address and request SOL (up to 5 SOL per request,
   max 2 requests per 8 hours).
3. Wait for the airdrop to land (usually under a minute).

(The CLI airdrop against the public RPC is closed — use the web
faucet, not `solana airdrop`.)

### 2. Open Ghost Mint and mint

1. Open the Ghost Mint demo link (TODO — until it is hosted, run it
   locally: `npm install`, then `cd apps/ghost-mint && npm run build`,
   then serve `dist/` with any static host, e.g.
   `npx serve dist`).
2. Confirm the network indicator says **devnet**.
3. Connect your wallet (Phantom or Solflare) from the top bar.
4. Check the stats row (minted, minters, inscriptions, listings,
   floor price) and the "how many you have minted / may still mint"
   line — the per-wallet limit is 4.
5. Mint one GHOST inscription. The app shows the exact cost before
   you confirm. Minting is free (0 lamports); you pay only the rent
   deposits, which are refundable.
6. Open the explorer link the app gives you. In the transaction logs
   you will find the inscription JSON in the memo, e.g.
   `{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"<your carrier NFT mint>"}`.
   That memo is the inscription; the NFT is its carrier.

### 3. Look up, leaderboard, activity

1. Paste any wallet address into the lookup to see its GHOST
   inscriptions (no wallet connection needed).
2. Check the minter leaderboard and the live activity feed — your
   mint should appear.

### 4. Trade on the Market

> **Only after the market program deploys.** Until then the market
> pages say so plainly and refuse trades. Check the deploy status in
> `docs/DEPLOY.md` or the program's explorer page:
> https://explorer.solana.com/address/3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo?cluster=devnet
> (it 404s until the deploy lands).

1. Open the Market demo link (TODO — until hosted, run locally:
   `cd apps/market && npm run build`, then serve `dist/`).
2. Connect the wallet that holds a carrier NFT.
3. List it at a fixed price (e.g. 1 SOL = 1,000,000,000 lamports).
   The NFT moves into escrow — it leaves your wallet until the
   listing is bought or cancelled.
4. From a **second** wallet (or ask someone else to), buy the
   listing. The buyer receives the NFT, the seller receives 99% of
   the price, and 1% goes to the treasury — all in one transaction.
5. List another NFT, then cancel the listing and confirm the NFT
   returns to your wallet.
6. Try to buy a listing that is already gone: the app refuses with a
   clear reason instead of taking your money.

### 5. Try the CLI (`skel`)

```sh
npm install
cd cli && npm run build
node dist/cli.js --help

# Read-only — no wallet needed:
node dist/cli.js status
node dist/cli.js lookup <wallet>

# Mint — needs a funded devnet keypair:
solana-keygen new --outfile ./agent-keypair.json
# fund it from https://faucet.solana.com, then:
node dist/cli.js mint --keypair ./agent-keypair.json
```

Every write shows a transaction preview first and sends only after
you type `yes` for that exact action. Market commands (`list`, `buy`,
`cancel`) refuse with a clear message until the program deploys. The
full agent manual is `agent.md` at the repo root.

### 6. Run the tests (optional)

```sh
npm test             # full unit suite (vitest, offline)
npm run typecheck    # TypeScript across the workspace
anchor test          # escrow program tests (8 tests, LiteSVM, in-process)
```

No test touches mainnet or real funds.

## How Kiro was used

> **TODO (owner).** This section is the owner's real experience of
> building Skelsol with Kiro, and only the owner can write it. Do not
> invent it. When writing it, cover: which Kiro surfaces were used
> (IDE, CLI, Web, Kiro Crew), how specs / hooks / steering / MCP were
> used, and what Kiro actually did in the build. The repo already
> carries the evidence a judge can check: the Kiro spec in
> `.kiro/specs/skelsol/` (`requirements.md`, `design.md`, `tasks.md`).

## Demo video

> **TODO (owner).** Record a public video under 3 minutes showing:
> getting devnet SOL from the faucet, minting a GHOST inscription in
> Ghost Mint and finding the inscription JSON in the explorer, the
> leaderboard and activity feed, listing/buying/cancelling in the
> Market (once the program is deployed), and one `skel` command in a
> terminal. Paste the public link here and in the Devpost form.

## Built with

- Solana (devnet) — Memo program v3, SPL Token, System Program
- Metaplex Token Metadata (Umi SDK) — carrier NFTs
- Anchor 1.2.2 (Rust) — `skelsol-market` escrow program
- TypeScript, Node.js, vitest — template library, apps, CLI, tests
- Wallet Standard (`@wallet-standard/app`) — browser wallet connection
- Kiro — spec-driven development (see `.kiro/specs/skelsol/`)

## Honest limits (for judges)

- **"SPL-20-style", not LibrePlex SPL-20.** The inscription JSON is
  written into a transaction memo; real LibrePlex inscriptions live
  in program-owned accounts. No existing SPL-20 indexer or
  marketplace will recognize these inscriptions, and there is no
  published SPL-20 specification.
- **Memo inscriptions live in transaction logs, not account state.**
  Verifiable from the transaction signature, but no on-chain program
  can read them.
- **The memo↔NFT binding is a documented convention** (same
  transaction, plus the mint address in the JSON's `mint` field), not
  something the chain enforces.
- **Supply caps and per-wallet limits are client-side rules**,
  enforced by the reader counting on-chain inscriptions. There is no
  custom mint program.
- See `docs/research-solana-inscriptions.md` §7 and
  `docs/adr/0002-memo-inscription-metaplex-carrier.md` for the full
  reasoning.
