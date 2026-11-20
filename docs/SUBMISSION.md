# Skelsol — Devpost submission draft (Kiroween 2026)

> **This file is a draft for the owner to paste into Devpost.** It is
> written from the repo as it stands on 20 November 2026. The
> market program is deployed on
> devnet and both demo apps are hosted; the status lines below already
> reflect that. The demo video was uploaded publicly to YouTube on
> 20 November 2026 (https://youtu.be/HBE63hOJhyI, 1:53, under the
> 3-minute limit).

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
| Ghost Mint (demo) | https://skelsol-ghost-mint.vercel.app |
| Inscription Market (demo) | https://skelsol-market.vercel.app |
| Demo video (under 3 minutes) | https://youtu.be/HBE63hOJhyI (uploaded publicly 20 Nov 2026, 1:53) |
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
- **No browser wallet in the build environment.** The hosted apps
  have been checked in a real browser (stats, market status,
  listings — the market was verified live on devnet on 19 Nov
  2026), but the wallet handshake and a live mint with
  Phantom/Solflare still need a human with a wallet in a real
  browser; the README says so.

### What's next

- **Host real collection art** (the config currently points at a
  placeholder image URL) and the off-chain metadata JSON on durable
  storage (Arweave/IPFS).
- **A real-browser test pass** with Phantom and Solflare: the wallet
  handshake and a live mint are the only parts of the demo flow not
  yet exercised in a real browser (the market program is deployed,
  both apps are hosted, and the stats and market status were
  re-checked on 19 Nov 2026).
- **Metaplex Core migration path** for lower mint cost if the
  compatibility trade-off ever flips (documented in ADR 0002).
- **On-chain inscription accounts** (LibrePlex or Metaplex
  `mpl-inscription`) if a future feature ever needs a program to read
  inscription content — memo data cannot be read on-chain.

## Current status (20 November 2026)

- **Minting works on devnet today**, verified live via `skel status`.
  It needs no custom program.
- **The market program is deployed on devnet** (19 Nov 2026;
  transaction `4RC4UVyowp6Ss9jkKVZQzq35hwaNAKnwg3Sk1xPAFhoWkbp26TLdxL6tjhMqmPXyicE23gtd69GWutNnFj4pakoM`).
  Program ID: `3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo`.
  Listing, buying, and cancelling work on devnet in both apps and in
  the CLI. See `docs/DEPLOY.md`.
- **The demo apps are hosted on Vercel:** Ghost Mint at
  https://skelsol-ghost-mint.vercel.app and Inscription Market at
  https://skelsol-market.vercel.app. They build to static sites
  (`apps/ghost-mint/dist/`, `apps/market/dist/`).
- **The wallet handshake and live mint in a real browser have not
  been tested** (they need a human with a wallet in a real browser).
  The stats, market status, and listings pages have been checked in
  a real browser on 19 Nov 2026.

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

1. Open the Ghost Mint demo link: https://skelsol-ghost-mint.vercel.app
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

> The market program is deployed on devnet and was verified live in
> a real browser on 19 Nov 2026 ("The market is live on devnet").
> Program explorer page:
> https://explorer.solana.com/address/3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo?cluster=devnet
> (deployed 19 Nov 2026; transaction `4RC4UVyowp6Ss9jkKVZQzq35hwaNAKnwg3Sk1xPAFhoWkbp26TLdxL6tjhMqmPXyicE23gtd69GWutNnFj4pakoM`).

1. Open the Market demo link: https://skelsol-market.vercel.app
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

Skelsol was built spec-first with Kiro CLI. The whole plan lives in
`.kiro/specs/skelsol/`: `requirements.md` states what the template
must do in EARS style with acceptance criteria, `design.md` lays out
the architecture (one template package, three consumers: two web apps
and the `skel` CLI), and `tasks.md` breaks the build into testable
tasks, each checked off as it landed. Kiro CLI drove the
implementation task by task, test-first, and the spec stayed the
source of truth when the build hit real problems — the slow page
load on the public RPC and the market read that failed in the browser
were both diagnosed against the spec and fixed with the decisions
recorded in `docs/adr/`. Judges can verify the whole trail in the
repo: the spec, the task list, and the ADRs.

## Demo video

https://youtu.be/HBE63hOJhyI

Uploaded publicly to YouTube 20 November 2026. Duration 1:53 (under
the 3-minute limit). Title on YouTube: "Skelsol — Skeleton SPL-20
Inscriptions token on Solana | Kiroween 2026". The video shows both
live demo apps (Ghost Mint and the Inscription Market), the `skel`
CLI, and the `.kiro` spec trail on GitHub, with narration and the
"The Dread" music bed (CC-BY, credited in the video description).
Paste this link into the Devpost form.

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
