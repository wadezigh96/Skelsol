# Design

Skelsol: a lean template for minting SPL-20-style inscriptions on Solana,
shown through two web applications and one CLI. This design implements the
requirements in `requirements.md` and follows the decisions in
`docs/adr/`.

## Overview

One template package holds all the logic. Three consumers use it:

```
packages/template      the template: inscription lib, mint client, reader,
                       config, wallet adapter, market client, UI kit
apps/ghost-mint        web app 1: mint ghost inscriptions
apps/market            web app 2: fixed-price inscription marketplace
cli/                   skel: the same template, driven from a terminal
programs/skelsol-market  the one Anchor program: market escrow
```

All chain reads go straight from the consumer to a public Solana RPC.
There is no server, no database, no API route. All state is on-chain.

## Architecture

### The mint flow

1. The user (or agent) picks a collection and asks to mint.
2. The mint client checks the reader: is supply left, is the wallet under
   its per-wallet limit? If not, it refuses with a reason.
3. The client builds one transaction with two parts, three for a priced
   collection:
   - a Memo instruction carrying the inscription JSON (SPL-20 shape, plus
     the `mint` field — see Binding convention below);
   - the NFT mint instructions (Metaplex Token Metadata `createNft`
     semantics via the Umi SDK): mint account, metadata account, master
     edition, one token to the minter;
   - for a priced collection only, a payment leg: a SystemProgram
     transfer of the mint price (`priceLamports`) from the payer to the
     collection's `treasury` address, in the same transaction, so
     payment and minting are atomic. A priced collection must configure
     a treasury (`loadCollectionConfig` refuses a price above 0 with no
     treasury); a free mint has no payment leg. The cost breakdown
     carries the price, the live rent, and an estimated network fee
     (5,000 lamports per signature, 2 signers), so the total the minter
     previews is the total they pay.
4. The client serializes the transaction and refuses it if it exceeds the
   1,232-byte packet cap.
5. The wallet signs; the transaction is sent; the client returns the
   signature and an explorer link.

### The read flow

The reader rebuilds collection state from on-chain records:

1. List recent transactions for the collection's known addresses via
   `getSignaturesForAddress`.
2. Fetch each transaction (`getTransaction`, `jsonParsed`) and extract
   memo log lines.
3. Parse each memo as inscription JSON; keep the ones whose `tick`
   matches the collection; verify the binding convention.
4. Aggregate: minted count, per-wallet counts, minter leaderboard,
   activity feed (newest first).

The reader caches by signature so a refresh only fetches new
transactions. It never trusts client input: counts come from the chain.

### The market flow

The market is the one place with a custom on-chain program,
`skelsol-market` (Anchor). It follows the canonical make/take/refund
escrow pattern from `solana-developers/program-examples`
(`tokens/escrow/anchor`), with the payment leg changed from tokens to SOL:

- `list`: the seller's carrier NFT (amount 1) moves into a PDA-owned
  vault token account. A listing account stores seller, mint, price in
  lamports, and bump.
- `buy`: the buyer pays the listing price in SOL — 99% to the seller, 1%
  to the treasury — and the program PDA-signs the NFT to the buyer's
  account. Both legs are atomic in one transaction. The listing and vault
  accounts close and their rent returns.
- `cancel`: seller only. The NFT returns to the seller; accounts close.

The program checks the price against the listing account, never against
client input. The vault must hold exactly 1 token of the listing's mint.

## Components

### Template package (`packages/template`)

| Module | Responsibility |
|---|---|
| `inscription` | Build, parse, and verify SPL-20-style JSON. Pure functions, no network. |
| `config` | Collection config (tick, name, supply, per-wallet limit, price, image) and network config (devnet/mainnet RPC, program IDs). Validated at load. |
| `mint` | Build the mint transaction (memo + NFT, plus the payment leg for a priced collection), check limits via the reader, estimate cost (live rent query + network fee), serialize-check the size. |
| `reader` | Rebuild collection state from transactions; leaderboard; activity; wallet lookup. |
| `market` | Build list/buy/cancel transactions against the escrow program; read open listings from program accounts; floor price. |
| `wallet` | Wallet Standard discovery, connect, sign. Framework-free. |
| `ui` | The spooky UI kit: Vision-style theme CSS (palette variables `--skel-bg #0a0a0a`, `--skel-accent #7f1d1d`, `--skel-text #ffffff`; giant display type; numbered sections; vertical edge text) and shared page sections (hero, stats row, lookup, leaderboard, activity). |

### Web apps (`apps/ghost-mint`, `apps/market`)

Static pages compiled with `tsc`. Dependencies resolve through an import
map with exact pinned versions (see ADR 0008). Each app is one page:

- Ghost Mint: hero, stats row, lookup, mint section, leaderboard, live
  activity.
- Market: hero, stats row, listings table, buy form, sell form, live
  activity.

Both share the UI kit, so they look like siblings.

### CLI (`cli/`)

`skel`, a Node.js binary on the template library. Commands: `status`,
`mint`, `list`, `buy`, `cancel`, `lookup`. Flags: `--network`,
`--json`, `--keypair`. Every write prints a preview and sends only after
the user confirms that exact action (see ADR 0007).

### Escrow program (`programs/skelsol-market`)

Anchor 1.x, Rust. Instructions `list`, `buy`, `cancel`. Accounts:
`Listing` (seller, mint, price, bump) and the PDA-owned vault token
account. Deployed to devnet; mainnet deploy is a manual step for the
owner later.

## Data models

### Inscription JSON

```json
{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"<mint address>"}
```

- `p`: always `"spl-20"`.
- `op`: `mint` (this release; `transfer` and `list` are reserved).
- `tick`: 1–10 chars, `[A-Z0-9]`.
- `amt`: a positive integer, as a string.
- `mint`: the carrier NFT's mint address. This is Skelsol's extension to
  the 4-field convention; it makes the inscription self-binding.

### Collection config

```json
{
  "tick": "GHOST",
  "name": "Spooky Ghosts",
  "supply": 4444,
  "perWalletLimit": 4,
  "priceLamports": 0,
  "treasury": "<treasury wallet address; required when priceLamports > 0>",
  "image": "https://…/ghost.png",
  "metadataBaseUri": "https://…/ghost/"
}
```

Price is the mint price in lamports (0 = free mint, rent only).
`treasury` is the wallet that receives the mint price: the mint
transaction pays `priceLamports` to it, so it is required when the
price is above 0 and unused for a free mint. The image and metadata
URIs are off-chain (IPFS/Arweave for production; any stable HTTPS host
for the demo).

### Listing account (on-chain)

- `seller`: the seller's public key.
- `mint`: the carrier NFT's mint.
- `price`: lamports per inscription.
- `bump`: the PDA bump.

## Binding convention

A memo inscription is bound to its carrier NFT by two facts, both
checkable by anyone with the transaction signature:

1. The memo instruction and the NFT mint instructions are in the same
   transaction.
2. The JSON's `mint` field equals the mint address created in that
   transaction.

The reader verifies both. The chain enforces neither; the docs say so.

## Interfaces

The template exposes one public surface per module (see `packages/template`
source for the exact signatures). The seams the tests target:

- Inscription library: `buildInscription`, `parseInscription`,
  `verifyInscription` (pure; no network).
- Mint client: `buildMintTransaction` (returns an unsigned transaction
  and a cost breakdown; sending is the caller's job).
- Reader: `getCollectionState`, `getLeaderboard`, `getActivity`,
  `lookupWallet` (against a `Connection`-like interface; tests use
  recorded transaction fixtures).
- Market client: `buildListTransaction`, `buildBuyTransaction`,
  `buildCancelTransaction`, `getListings`, `getFloorPrice`.
- Wallet adapter: `discoverWallets`, `connect`, `signTransaction`.
- CLI: argument parsing and `--json` output shape.

## Error handling

- Every refusal carries a reason in plain words: supply exhausted,
  per-wallet limit reached, listing gone, price changed, insufficient
  balance, oversize transaction, missing keypair.
- A malformed memo never crashes the reader; it is skipped and counted.
- RPC failures surface as "could not reach the network, try again",
  never as a stack trace in the UI.

## Testing strategy

- Vitest unit tests at every seam above. Fixtures are recorded
  transactions (checked in), not live RPC calls, so `npm test` is fast
  and offline.
- Anchor tests for the escrow program (list/buy/cancel, seller-only
  cancel, wrong-price rejection, rent reclaim on close).
- Devnet integration tests (mint, list, buy, cancel against the deployed
  program) run separately, marked so `npm test` stays offline.
- No test touches mainnet or real funds.

## Security considerations

- Never load `@solana/web3.js@latest` from a CDN (versions 1.95.6/1.95.7
  were compromised). Pin exact versions in the import map.
- Never ask for seed phrases or private keys in the web apps. The CLI
  reads a local keypair file only when `--keypair` is given, and warns:
  never commit a keypair, never use one holding large funds.
- The escrow program never trusts client-supplied prices or recipients;
  the fee recipient is a fixed address in the program config.
- Preview-before-send: every write (app and CLI) shows what the
  transaction does and costs before the wallet is asked to sign.

## Deployment

- Apps: static deploy to Vercel (build: `tsc`, output: static files).
  Any static host works.
- Escrow program: `anchor deploy` to devnet, program ID recorded in
  `docs/DEPLOY.md` with the explorer link and the `solana program show`
  output. A redeploy script is kept because devnet can reset.
- CLI: published as the repo's `skel` binary (`npm run build` then
  `node dist/cli.js`, or `npm link`).
