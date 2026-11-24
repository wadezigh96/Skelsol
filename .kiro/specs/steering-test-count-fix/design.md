# Design

Implements the requirement in `.kiro/specs/steering-test-count-fix/
requirements.md`.

## Change

A single edit to `.kiro/steering/build-and-test.md`, in the "Anchor / Rust
(the escrow program)" section. The sentence

> 8 tests, covering list/buy/cancel happy paths, seller-only cancel,
> wrong-price rejection, and rent reclaim on close.

becomes a corrected count (11) with a coverage summary that accounts for
every `#[test]` function in `programs/skelsol-market/tests/market.rs`:

- list happy path: `list_moves_nft_into_vault_and_stores_listing`
- list rejects non-NFT mint: `list_rejects_non_nft_mint`
- buy happy path (fee split): `buy_pays_seller_and_treasury_and_releases_nft`
- buy fee rounding: `buy_rounds_fee_down_and_seller_gets_remainder`
- buy zero-fee / no treasury: `buy_at_price_under_100_lamports_succeeds_without_treasury`
- buy rejects mismatched mint: `buy_rejects_mismatched_mint`
- buy rejects insufficient funds: `buy_rejects_buyer_who_cannot_pay_listed_price`
- buy rejects wrong treasury: `buy_rejects_wrong_treasury_account`
- cancel happy path / rent reclaim: `cancel_returns_nft_to_seller_and_closes_accounts`
- cancel rejects mismatched mint: `cancel_rejects_mismatched_mint`
- cancel rejects non-seller: `cancel_rejects_non_seller`

## Scope

Only `.kiro/steering/build-and-test.md` changes. The test file and the hook
file are not touched. The edit is documentation only, so it does not affect
`npm test` or `npm run typecheck`.
