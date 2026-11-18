# Skelsol Glossary

Shared domain vocabulary for the Skelsol project. Every spec, ticket, and code
comment uses these terms with exactly these meanings.

## Project

- **Skelsol**: the project. A lean template (skeleton) for minting inscriptions
  on Solana, plus two distinct applications built from it.
- **Template**: the reusable core: inscription library, mint client, inscription
  reader/indexer, collection config, wallet adapter, and the spooky UI kit.
  An app is a template plus a collection config plus its own pages.
- **Skeleton Crew**: the Kiroween 2026 category Skelsol enters. One lean code
  template, shown through two distinct applications.
- **Kiroween 2026**: Kiro's Halloween hackathon on Devpost. Submission period
  30 October to 4 December 2026. Only new projects built during the period
  are eligible.

## Inscriptions

- **Inscription**: a JSON text record written on-chain. In Skelsol the JSON
  follows the SPL-20 shape: `{"p":"spl-20","op":"mint","tick":"...","amt":"..."}`.
- **SPL-20**: the inscription format convention on Solana, popularised by
  LibrePlex. `p` is the protocol, `op` the operation, `tick` the ticker,
  `amt` the amount. Skelsol inscriptions are SPL-20-*style*: the JSON is
  written on-chain via a Memo instruction, and an NFT is minted as the
  inscription's carrier.
- **Tick**: the short ticker symbol of an inscription collection, e.g. `GHOST`.
- **Carrier NFT**: the NFT minted together with an inscription. It carries the
  inscription's image and metadata; the inscription JSON itself lives in the
  transaction memo. One mint produces one inscription plus one carrier NFT.
- **Mint**: the act of creating an inscription (and its carrier NFT) on-chain.
- **Collection**: one configured inscription series: its tick, name, supply cap,
  per-wallet limit, price, image, and network. Ghost Mint and the market's
  listings each work on collections.
- **Supply**: the maximum number of inscriptions a collection can mint.
- **Per-wallet limit**: the maximum number of inscriptions one wallet may mint
  in a collection.

## Market

- **Listing**: an inscription offered for sale at a fixed price, held in escrow
  until bought or cancelled.
- **Escrow**: the on-chain holding of a listed carrier NFT by the market
  program. The seller cannot spend it while listed; the buyer receives it on
  purchase; the seller gets it back on cancel.
- **Floor price**: the lowest price among currently open listings of a
  collection.
- **Fee**: 1% of a sale, paid to the treasury; the seller receives 99%.

## Network and wallets

- **Mainnet**: Solana mainnet-beta. Real SOL, real money. The framework
  supports it; the demo apps do not default to it.
- **Devnet**: Solana's public test network. SOL is free (faucet/airdrop).
  The demo apps default to devnet so judges can try everything for free.
- **Network switch**: the in-app control that moves an app between devnet and
  mainnet. Switching changes the RPC endpoint, the program IDs in use, and
  the collections shown.
- **Wallet adapter**: the browser wallet connection layer (Phantom, Solflare)
  used to sign mint and market transactions.

## App vocabulary (mirrors the Spooky B-Agents reference site)

- **Ghost Mint**: application 1. Mint ghost inscriptions, see live stats,
  check any wallet, view the minter leaderboard and live activity.
- **Inscription Market**: application 2. List, buy, and cancel inscription
  sales at fixed prices.
- **skel**: the command-line interface (CLI) for AI agents, the third consumer
  of the template. An agent runs `skel` commands in a terminal to use
  Skelsol: `status`, `mint`, `list`, `buy`, `cancel`, `lookup`.
- **Keypair file**: the local file holding an agent wallet's secret key,
  passed to `skel` with `--keypair <path>`. Never committed to the repo,
  never holding large funds.
- **Preview**: the transaction summary `skel` shows before sending anything:
  what the transaction does, what it costs, and what could go wrong. An
  agent must show the preview and wait for the user's explicit yes before
  sending.
- **agent.md**: the manual for AI agents at the repo root. It explains how to
  use `skel`, the safety rules, and worked examples.
- **Stats row**: the live numbers shown under the hero: minted, minters,
  inscriptions, active listings, floor price.
- **Leaderboard**: top minters of a collection, built from on-chain records.
  Transfers are not tracked, so this counts minting, not current ownership.
- **Live activity**: the recent stream of mints, transfers, listings, and buys.
- **Vision style**: the visual style of both apps, after the Framer Vision
  Portfolio template: giant bold type, numbered sections, vertical edge
  text, thin divider lines. Palette: near-black `#0a0a0a` background,
  maroon `#7f1d1d` accent, white text. Dark throughout; never orange,
  never a white background. See ADR 0009.
- **Numbered section**: a page section headed by a number and a label
  (e.g. `01 /MINT`), separated by a thin rule.
- **Vertical text**: large faint text rotated 90 degrees along the page
  edge (e.g. `/ghost mint`).
