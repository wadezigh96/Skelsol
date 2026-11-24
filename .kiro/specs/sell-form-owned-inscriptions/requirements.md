# Requirements

Ownership-based inscription lookup for the Market sell form. This spec
fixes a proven browser bug (24 Nov 2026): the Market app's sell form
finds listable NFTs with `lookupWallet`, which scans only the last 20
Memo-program transactions (about 7 seconds of devnet traffic) and
attributes inscriptions from mint transactions only. A judge who mints
and then tries to list almost always sees "This wallet has minted no
GHOST inscriptions yet", and a buyer can never re-list a bought NFT
because transfers are never observed.

Vocabulary: see `GLOSSARY.md` at the repo root. EARS style: see
`.kiro/specs/skelsol/requirements.md`.

## 1. Ownership-based lookup

### Requirement 1.1 — Find inscriptions the wallet currently owns

WHEN the Market app needs to list a wallet's sellable carrier NFTs, THE
reader SHALL provide `lookupOwnedInscriptions(connection, config,
wallet, options?)` that returns `WalletInscription[]` (mint, tick,
signature, blockTime, slot, newest first) for GHOST inscriptions the
wallet currently owns.

Acceptance criteria:

- WHEN a wallet owns a carrier NFT, THE reader SHALL list it regardless
  of whether the mint transaction is inside the Memo scan window.
- WHEN a wallet owns a carrier NFT it received by transfer or purchase,
  THE reader SHALL list it even though the mint transaction's original
  holder is a different wallet.
- WHEN the wallet address is malformed, THE reader SHALL reject with a
  `ReaderError` (`invalid-wallet`).

### Requirement 1.2 — Token-account-based discovery

WHEN `lookupOwnedInscriptions` is called, THE reader SHALL list the
wallet's SPL token accounts with a positive balance via
`getParsedTokenAccountsByOwner` and treat each mint as a candidate.

Acceptance criteria:

- WHEN a token account has a zero balance, THE reader SHALL exclude it
  before checking its mint.
- WHEN a candidate mint's mint transaction has no verified GHOST
  inscription, THE reader SHALL skip it without failing.

### Requirement 1.3 — Mint-transaction verification

WHEN a candidate mint is checked, THE reader SHALL find its mint
transaction (the oldest signature from `getSignaturesForAddress`), fetch
it, and verify the GHOST inscription by reusing `parseInscription`,
`verifyInscription`, and `verifyBinding`.

Acceptance criteria:

- WHEN the mint transaction is fetched, THE reader SHALL pass
  `maxSupportedTransactionVersion: 1` to `getParsedTransaction`, so
  versioned transactions are not rejected with JSON-RPC error -32015.
- WHEN a mint's mint transaction cannot be fetched (pruned, null), THE
  reader SHALL skip that mint, never fail.

## 2. Independence from the scan window

### Requirement 2.1 — No Memo scan

WHEN `lookupOwnedInscriptions` runs, THE reader SHALL NOT scan the Memo
program address. The lookup goes directly to the wallet's token
accounts, so a mint that aged out of the 20-transaction Memo window
still appears.

## 3. Caps and limits (design facts)

### Requirement 3.1 — Candidate-mint cap

THE reader SHALL check at most the first 20 candidate mints (token
accounts with a positive balance). A wallet that holds many NFTs has
only its first 20 checked; the rest are skipped.

### Requirement 3.2 — Mint-signature limit

THE reader SHALL fetch at most 10 signatures per candidate mint and take
the oldest. WHEN the mint transaction is not among them (a heavily traded
NFT with more than 10 transactions), THE reader SHALL skip that mint.

## 4. Market app wiring

### Requirement 4.1 — Sell form uses ownership lookup

THE Market app's sell form SHALL call `lookupOwnedInscriptions` instead
of `lookupWallet` in `refreshSellCandidates`.

Acceptance criteria:

- WHEN the wallet owns no GHOST inscriptions, THE sell form SHALL say
  "This wallet owns no GHOST inscriptions yet. Mint one in Ghost Mint
  first."
- WHEN every owned inscription is already listed, THE sell form SHALL
  say "Every inscription this wallet owns is already listed."

### Requirement 4.2 — LookupWallet unchanged

THE reader SHALL NOT change `lookupWallet`. Ghost Mint's wallet lookup
and the CLI keep mint-attribution semantics (they count mints, not
current holdings).

## 5. Testability

### Requirement 5.1 — Fake-connection testable

THE new function SHALL read through a minimal connection interface
(`OwnedLookupConnection`) backed by a fake in tests, following the
existing `ReaderConnection` / `ParsedTransactionConnection` /
`toReaderConnection` adapter pattern.

### Requirement 5.2 — Required tests

WHEN the test suite runs, THE following cases SHALL pass:

- (a) An owned GHOST carrier appears.
- (b) A bought inscription appears even though the mint transaction's
  holder is a different wallet (the buyer re-list regression test).
- (c) A mint aged out of the scan window still appears (the new function
  does not use the scan at all).
- (d) Non-GHOST mints, zero-balance token accounts, and unfetchable mint
  transactions are excluded or skipped, never fatal.
- (e) The 20-mint cap is honored.
- (f) `maxSupportedTransactionVersion: 1` is passed to
  `getParsedTransaction` for the mint-transaction fetch.

## 6. Quality gates

### Requirement 6.1 — Build, test, typecheck

WHEN `npm run build` then `npm test` then `npm run typecheck` run, THE
workspace SHALL pass with zero failures. THE reader tests SHALL stay
offline (no live RPC calls, no mainnet, no real funds).
