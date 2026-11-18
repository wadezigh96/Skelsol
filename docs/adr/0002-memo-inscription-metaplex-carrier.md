# ADR 0002: Memo-based SPL-20-style inscriptions with a Metaplex NFT carrier

Status: Accepted (2026-11-19). Confirmed by primary-source research in
`docs/research-solana-inscriptions.md`.

## Context

Solana inscriptions follow the SPL-20 convention popularised by LibrePlex:
a JSON text record such as
`{"p":"spl-20","op":"mint","tick":"sols","amt":"1000"}`. Research found
there is **no published SPL-20 specification**: the JSON shape is a
community convention, balances are indexer-defined, and LibrePlex is the
historical originator, not a maintained 2026 reference (Anchor 0.30-era
crate, docs that do not cover SPL-20). Real LibrePlex inscriptions store
the JSON in inscription accounts owned by the LibrePlex program; a memo
stores it in transaction logs instead. The two are not the same thing.

## Decision

- Write the inscription JSON on-chain with a Memo instruction (Memo v3,
  `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) in the mint transaction.
  The memo is the inscription record; anyone can read it back from the
  transaction logs via the transaction signature.
- Mint one Metaplex Token Metadata NFT per inscription as its carrier
  (image and metadata), via the Umi SDK `createNft`.
- **Binding convention**: the memo and the NFT mint are in the same
  transaction, and the JSON carries the mint address in an extra `mint`
  field: `{"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"<mint
  address>"}`. The chain does not enforce this binding; the reader verifies
  it by reading the transaction. The convention is documented wherever
  inscriptions are described.
- **Label**: the project says "SPL-20-style" everywhere, never "SPL-20" or
  "LibrePlex SPL-20". No existing SPL-20 indexer or marketplace will
  recognise memo inscriptions, and the docs say so.
- **Token Metadata over Core, deliberately**: Metaplex recommends Core for
  new projects, but Token Metadata is the compatibility-maximising choice
  (every wallet, explorer, and marketplace reads it) and its carrier is a
  standard SPL token, which is what the classic Anchor escrow pattern
  moves. Cost and novelty lose to compatibility here. Core is the
  documented migration path if that trade-off ever flips.
- No custom on-chain program for minting. Supply caps and per-wallet
  limits are enforced off-chain by the reader (counting on-chain
  inscriptions) and are stated honestly as client-side rules, not
  consensus rules.
- Rent figures are never hard-coded (SIMD-0437 is cutting rent in steps);
  the mint client queries `getMinimumBalanceForRentExemption` at runtime.
- The mint transaction must fit the 1,232-byte packet cap; the client
  serializes before sending and refuses an oversize transaction.

## Consequences

- Minting needs no program deploy and no program audit.
- The inscription is verifiable by reading the transaction memo; the
  reader is the source of truth for "minted" counts.
- Memo data cannot be read by on-chain programs. Nothing in the mint or
  market flow needs that, so it is not a blocker; it rules out future
  features where the escrow program would check inscription content.
