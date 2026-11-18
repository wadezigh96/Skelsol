# Requirements

Skelsol: a lean template for minting SPL-20-style inscriptions on Solana,
shown through two web applications (Ghost Mint, Inscription Market) and one
CLI (`skel`) for AI agents. Kiroween 2026, category Skeleton Crew.

Vocabulary: see `GLOSSARY.md` at the repo root. Decisions: see `docs/adr/`.

## 1. Inscription library

### Requirement 1.1 — Build a valid inscription

WHEN a caller builds an inscription with a protocol, operation, ticker, and
amount, THE template SHALL produce the canonical SPL-20 JSON
`{"p":"spl-20","op":"mint","tick":"<tick>","amt":"<amt>"}`.

Acceptance criteria:

- WHEN the ticker contains characters outside `[A-Z0-9]{1,10}`, THE library
  SHALL reject the build with a clear error.
- WHEN the amount is not a positive integer, THE library SHALL reject the
  build with a clear error.
- WHEN the operation is not `mint`, THE library SHALL reject the build
  with a clear error. This release accepts `mint` only; `transfer` and
  `list` are not implemented (see design.md and ticket 01).

### Requirement 1.2 — Parse and verify an inscription

WHEN the reader receives inscription JSON text, THE template SHALL parse it
and verify it against the same rules as building.

Acceptance criteria:

- WHEN the JSON is malformed, THE library SHALL return a parse error, not
  throw an uncaught exception.
- WHEN the JSON is valid SPL-20 but for a different ticker, THE library
  SHALL report it as valid but not belonging to the queried collection.
- WHEN the same JSON is built and then parsed, THE result SHALL round-trip
  exactly.

## 2. Mint client

### Requirement 2.1 — Mint an inscription

WHEN a connected wallet mints from a collection, THE mint client SHALL send
one transaction that writes the inscription JSON on-chain and mints one
carrier NFT to the minter.

Acceptance criteria:

- WHEN the collection supply is exhausted, THE mint client SHALL refuse
  before building the transaction and SHALL explain why.
- WHEN the wallet has already minted up to the per-wallet limit, THE mint
  client SHALL refuse before building the transaction and SHALL explain
  why.
- WHEN the mint succeeds, THE mint client SHALL return the transaction
  signature and an explorer link.

### Requirement 2.2 — Show the cost before sending

WHEN a mint is about to be built, THE mint client SHALL report the exact
cost (mint price plus estimated fees) before the wallet is asked to sign.

## 3. Inscription reader

### Requirement 3.1 — Rebuild collection state from the chain

WHEN asked for a collection's state, THE reader SHALL count inscriptions
from on-chain transaction records and report minted count, remaining
supply, and minter counts.

Acceptance criteria:

- WHEN no inscriptions exist yet, THE reader SHALL report zero minted and
  full supply remaining.
- WHEN a wallet address is looked up, THE reader SHALL list that wallet's
  inscriptions in the collection.

### Requirement 3.2 — Leaderboard and activity

WHEN asked for the leaderboard, THE reader SHALL return minters ordered by
inscription count, most first.

WHEN asked for recent activity, THE reader SHALL return the most recent
mint, transfer, listing, and buy events, newest first.

## 4. Collection configuration

### Requirement 4.1 — One config per collection

WHEN a developer adds a collection, THE template SHALL require only one
configuration: ticker, name, supply cap, per-wallet limit, price, image,
and network addresses.

Acceptance criteria:

- WHEN the config is invalid (missing ticker, non-positive supply), THE
  template SHALL reject it at load time with a clear error.
- WHEN two apps use the same config, THEY SHALL show the same collection
  state.

## 5. Network support

### Requirement 5.1 — Devnet default, mainnet by switch

WHEN an app or the CLI starts without a network flag, THE system SHALL use
devnet.

WHEN the user switches to mainnet, THE system SHALL use the mainnet RPC
endpoint and mainnet program IDs, and SHALL show a visible mainnet
indicator.

Acceptance criteria:

- WHEN on devnet, THE system SHALL never send a transaction to mainnet.
- WHEN the network switch happens, THE displayed collection state SHALL
  refresh for the new network.

## 6. Ghost Mint (web application 1)

### Requirement 6.1 — Mint page

WHEN a visitor opens Ghost Mint, THE app SHALL show the hero, the stats
row (minted, minters, inscriptions, listings, floor price), a wallet
lookup, and the mint section.

WHEN a visitor connects a wallet, THE app SHALL show how many inscriptions
that wallet has minted and how many it may still mint.

### Requirement 6.2 — Leaderboard and activity

WHEN a visitor opens Ghost Mint, THE app SHALL show the minter leaderboard
and the live activity feed, refreshed from the chain.

## 7. Inscription Market (web application 2)

### Requirement 7.1 — Listings

WHEN a visitor opens the market, THE app SHALL show all open listings
(seller, amount, price per inscription, total) and the floor price.

WHEN a seller lists a carrier NFT, THE market program SHALL hold the NFT
in escrow until it is bought or the listing is cancelled.

### Requirement 7.2 — Buy and cancel

WHEN a buyer buys a listing, THE market program SHALL move the NFT to the
buyer, pay 99% of the price to the seller, and pay 1% to the treasury, in
one transaction.

WHEN a seller cancels a listing, THE market program SHALL return the NFT
to the seller.

Acceptance criteria:

- WHEN a non-seller tries to cancel a listing, THE program SHALL reject
  the transaction.
- WHEN a buyer tries to buy a listing that no longer exists, THE app SHALL
  refuse before building the transaction and SHALL explain why.

## 8. skel CLI (AI-agent consumer)

### Requirement 8.1 — Commands

THE CLI SHALL provide `status`, `mint`, `list`, `buy`, `cancel`, and
`lookup` commands, each built on the template library.

WHEN `--json` is passed, THE CLI SHALL print machine-readable JSON and no
other text to stdout.

WHEN `--network` is not passed, THE CLI SHALL use devnet.

### Requirement 8.2 — Wallet and safety

WHEN a command needs to sign, THE CLI SHALL load the wallet from a local
keypair file given by `--keypair <path>`.

WHEN a command would send a transaction, THE CLI SHALL print a preview
(what it does, what it costs) and SHALL send only after the user
explicitly confirms that exact action.

Acceptance criteria:

- WHEN no `--keypair` is given for a write command, THE CLI SHALL refuse
  with a clear error.
- WHEN the keypair file is missing or malformed, THE CLI SHALL refuse with
  a clear error.

### Requirement 8.3 — agent.md manual

THE repo root SHALL contain `agent.md`: a manual for AI agents covering
the CLI commands, the safety rules, and worked examples.

## 9. Submission artefacts

### Requirement 9.1 — Kiro spec directory

THE repo SHALL contain `.kiro/specs/skelsol/` with `requirements.md`,
`design.md`, and `tasks.md`.

### Requirement 9.2 — Submission draft

THE repo SHALL contain `docs/SUBMISSION.md`: a Devpost draft with judge
testing instructions. The demo video link and the "How Kiro was used"
section SHALL remain honest TODO placeholders until the owner provides
them.

## 10. Quality gates

### Requirement 10.1 — Tests

WHEN `npm test` runs, THE unit suite SHALL pass with no failures.

WHEN the escrow program changes, THE Anchor tests SHALL pass.

### Requirement 10.2 — No real funds in tests

WHEN any test runs, THE system SHALL NOT send a transaction to mainnet or
spend real funds.
