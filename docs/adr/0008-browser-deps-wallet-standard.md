# ADR 0008: Browser dependencies via pinned import map; Wallet Standard

Status: Accepted (2026-11-19). Grounded in
`docs/research-solana-inscriptions.md` section 6.

## Context

The web apps are static sites compiled with `tsc` (no bundler). Their
Solana dependencies (`@solana/web3.js`, Umi, Metaplex, Wallet Standard)
are npm ESM packages. Browsers cannot resolve bare npm specifiers without
help, and loading transaction-building code from a CDN is a supply-chain
risk: versions 1.95.6 and 1.95.7 of `@solana/web3.js` were compromised.

## Decision

- The apps load Solana packages as ES modules from an ESM CDN (esm.sh)
  through an **import map with exact pinned versions**. Never `@latest`.
  The pinned versions are recorded in the table below and in the app
  import maps (`apps/*/public/index.html`); a version bump is a
  deliberate change, made in both places at once.

## Pinned versions

Verified 2026-11-19 against `packages/template/package.json` and both
app import maps. The npm versions and the import-map versions must
match exactly: the same template source runs in Node (from
`node_modules`) and in the browser (from esm.sh), so a drifted version
would mean the two environments run different code.

| Package | Pinned version |
|---|---|
| `@solana/web3.js` | 1.99.0 |
| `@metaplex-foundation/umi` | 1.6.0 |
| `@metaplex-foundation/umi-bundle-defaults` | 1.6.0 |
| `@metaplex-foundation/umi-web3js-adapters` | 1.6.0 |
| `@metaplex-foundation/mpl-token-metadata` | 4.0.0 |
| `@wallet-standard/app` | 1.1.1 |
| `@solana/wallet-standard-features` | 1.5.0 |
- Wallet connection uses the **Wallet Standard** (`@wallet-standard/app`,
  `@solana/wallet-standard-features`): wallets register themselves, the
  app discovers them with `getWallets()`, connects, and signs. This is
  the neutral multi-wallet path (Phantom, Solflare, Backpack) per
  Phantom's current docs.
- The CLI and tests resolve the same imports from `node_modules` (npm),
  so the template library source is identical in browser and Node; only
  the module resolution differs.
- Transactions are legacy (v0 at most): Phantom docs note Ledger cannot
  sign Solana v1 transactions.
- The page never asks for a seed phrase or private key. The wallet signs;
  the page only builds unsigned transactions.

## Consequences

- No bundler is needed, keeping the static-site promise.
- The import map is a single point of review for supply-chain safety.
- The wallet handshake cannot be fully tested in this build environment
  (no browser extension here); it needs a real-browser check before demo
  day, and the final report must say so if that check has not happened.
