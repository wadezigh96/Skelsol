# Skelsol — Spec

Template (skeleton) for minting SPL-20-style inscriptions on Solana, shown
through two web applications and one CLI. Built for Kiroween 2026, category
Skeleton Crew.

Vocabulary: see `GLOSSARY.md`. Decisions: see `docs/adr/`.

## Problem Statement

Inscription minting on Solana is fragmented: a creator who wants to launch
an inscription collection must wire together the SPL-20 JSON convention,
the on-chain write, an NFT carrier, a mint page, and (if they want trading)
a marketplace, each from scratch. There is no small, honest, reusable
starting point, and the existing inscription tooling is hard for a judge or
a newcomer to try without spending real money.

## Solution

Skelsol is one lean template that a creator configures (ticker, supply,
price, image) and gets:

- a mint client that writes an SPL-20-style inscription JSON on-chain and
  mints an NFT carrier for it;
- a reader that rebuilds collection state (minted, minters, activity) from
  on-chain records;
- two working web applications built from the template (Ghost Mint and the
  Inscription Market) with a shared spooky UI kit;
- a CLI (`skel`) so AI agents can use the same template from a terminal;
- a minimal escrow program so the market trades without trust.

The demo apps default to devnet, so anyone can try the whole flow for free.

## User Stories

### Visitors and judges

1. As a judge, I want to open a demo link and see a working app without
   installing anything, so that I can evaluate the project quickly.
2. As a judge, I want to try minting, listing, buying, and cancelling for
   free on devnet, so that I can verify the whole flow without spending
   real money.
3. As a visitor, I want to see live collection stats (minted, minters,
   inscriptions, listings, floor price), so that I know the collection's
   state at a glance.
4. As a visitor, I want to look up any wallet address and see its
   inscriptions, so that I can check holdings without connecting a wallet.
5. As a visitor, I want to see a minter leaderboard, so that I can see who
   minted the most inscriptions. (Transfers are not tracked, so this
   counts minting, not current ownership.)
6. As a visitor, I want to see live activity (mints, transfers, listings,
   buys), so that I can see the collection is alive.
7. As a visitor, I want to switch the app between devnet and mainnet, so
   that I can choose free testing or the real network.

### Minters (Ghost Mint)

8. As a minter, I want to connect my Solana wallet (Phantom or Solflare),
   so that I can mint from my own wallet.
9. As a minter, I want to mint an inscription with one click, so that I get
   my ghost inscription and its carrier NFT.
10. As a minter, I want to see the exact cost before I confirm, so that I
    am never surprised by a transaction.
11. As a minter, I want the app to refuse a mint that would exceed the
    supply cap or my per-wallet limit, with a clear reason, so that I do
    not waste a transaction.
12. As a minter, I want a link to the transaction on the Solana explorer,
    so that I can verify my inscription on-chain.
13. As a minter, I want to see how many inscriptions I have minted and how
    many I may still mint, so that I know where I stand against the limit.

### Traders (Inscription Market)

14. As a seller, I want to list a carrier NFT I own at a fixed price, so
    that others can buy it.
15. As a seller, I want my listed NFT held in escrow, so that a buyer can
    trust it will be there when they pay.
16. As a seller, I want to cancel my listing at any time and get my NFT
    back, so that I stay in control.
17. As a seller, I want to receive 99% of the sale price, with 1% going to
    the treasury, so that the split is exactly as advertised.
18. As a buyer, I want to see all open listings with seller, amount, and
    price, so that I can choose what to buy.
19. As a buyer, I want to see the floor price, so that I know the cheapest
    listing at a glance.
20. As a buyer, I want to buy a listing and receive the NFT in the same
    transaction, so that payment and delivery are atomic.
21. As a buyer, I want the app to refuse a buy when the listing is gone or
    the price changed, with a clear reason, so that I do not pay for
    something that is not there.

### AI agents (skel CLI)

22. As an AI agent, I want to check a collection's status from the
    terminal, so that I can report supply, minted count, and floor price.
23. As an AI agent, I want to mint, list, buy, and cancel through CLI
    commands, so that I can act on the user's behalf without a browser.
24. As an AI agent, I want `--json` output, so that I can parse results
    reliably.
25. As an AI agent, I want every write to show a transaction preview first,
    so that I can show the user exactly what will happen before anything
    is sent.
26. As an AI agent, I want to use a local keypair file as my wallet, so
    that I can sign without a browser extension.
27. As an AI agent, I want a written manual (`agent.md`), so that I know
    the commands, the safety rules, and the worked examples.

### Template users (developers)

28. As a developer, I want to define a new collection by changing one
    config, so that I can launch my own inscription series without
    touching the mint logic.
29. As a developer, I want the template's library to be UI-free, so that I
    can use it from a web app, a CLI, or a script.
30. As a developer, I want the inscription JSON format documented and
    validated, so that my inscriptions are well-formed.
31. As a developer, I want tests that prove the inscription round-trip
    (build, parse, verify), so that I can trust the library.

### The project owner

32. As the owner, I want the repository to carry the `/.kiro` spec
    directory, so that the Kiroween submission requirement is met.
33. As the owner, I want an honest submission draft with judge
    instructions, so that judges can test the project end to end.
34. As the owner, I want the escrow program deployed to devnet with a
    public program ID, so that the market is real, not a mock.

## Implementation Decisions

- One template package: inscription library (build/parse/verify SPL-20
  JSON), mint client (memo + NFT carrier), inscription reader (rebuilds
  state from on-chain transactions), collection config, wallet adapter,
  spooky UI kit. See ADR 0001.
- Inscriptions are SPL-20-style JSON written via a Memo instruction; the
  carrier is a Metaplex NFT. No custom mint program. Supply caps and
  per-wallet limits are client-side rules enforced by the reader, stated
  honestly as such. See ADR 0002 (Accepted 2026-11-19, confirmed by
  the primary-source research in
  `docs/research-solana-inscriptions.md`).
- One Anchor program, `skelsol-market`, for fixed-price escrow: list, buy,
  cancel. 1% fee to the treasury, 99% to the seller. Deployed to devnet.
  See ADR 0003.
- TypeScript everywhere; apps compile with `tsc` to static files; no
  server; tests with vitest. See ADR 0004.
- Devnet default, mainnet by switch, for both apps and the CLI. See
  ADR 0005.
- Both apps share the spooky UI kit and mirror the Spooky B-Agents layout
  (hero, stats row, lookup, mint/market sections, leaderboard, live
  activity). The visual style follows the Framer Vision Portfolio
  template: giant bold type, numbered sections, vertical edge text,
  near-black `#0a0a0a` with a maroon `#7f1d1d` accent and white text,
  dark throughout (no orange, no white sections). All assets are new.
  See ADR 0006 and ADR 0009.
- `skel` CLI (Node.js binary, TypeScript) on the template library:
  `status`, `mint`, `list`, `buy`, `cancel`, `lookup`; flags `--network`
  and `--json`; wallet via `--keypair <path>`; preview-before-send safety
  rule; `agent.md` manual at the repo root. See ADR 0007.
- Testing seams: the inscription library (pure functions, no network),
  transaction builders (produce instructions, verified without sending),
  the reader (against recorded transaction fixtures), the escrow program
  (Anchor tests), the CLI (argument parsing and output formatting).
  Devnet integration tests run where the network allows.

## Testing Decisions

- A good test checks external behaviour, not implementation details: a
  valid inscription JSON parses and verifies; an invalid one is rejected
  with a reason; a mint transaction contains the memo and the NFT
  instructions; a listing escrows the NFT and a buy moves it.
- Every module in the template is unit-tested with vitest. The escrow
  program is tested with Anchor tests. The CLI is tested for argument
  parsing, `--json` output shape, and transaction building.
- Devnet integration tests (mint, list, buy, cancel against the deployed
  program) run when the network and toolchain allow; they are marked
  separately so `npm test` stays fast and offline.
- No test ever touches mainnet or real funds.

## Out of Scope

- Mainnet deploy of the escrow program (a manual step for the owner later).
- A custom mint program or on-chain enforcement of supply caps.
- Fungible SPL-20 token balances or a DEX; inscriptions here are
  non-fungible (one inscription, one carrier NFT).
- Auctions, offers, or royalties beyond the flat 1% market fee.
- User accounts, backend servers, or databases. All state is on-chain.
- Reusing Spooky B-Agents code, images, or contracts.

## Further Notes

- Kiroween submission needs: public repo with `/.kiro` at the root, a
  working app, a demo video under 3 minutes, and a "How Kiro was used"
  write-up. The write-up is the owner's real experience and is left as an
  honest placeholder in `docs/SUBMISSION.md`; it must not be invented.
- Deadline: 4 December 2026, 2:00 PM Pacific (5 December 2026, 05:00 WIB).
