use anchor_lang::prelude::*;

/// A fixed-price listing: one carrier NFT held in escrow for `price` lamports.
///
/// PDA seeds: `["listing", seller, mint]`. One listing per (seller, mint) pair:
/// a seller cannot list the same NFT twice, because the second `list` would
/// try to re-initialize the same listing account (and the NFT is already in
/// the vault).
#[account]
#[derive(InitSpace)]
pub struct Listing {
    /// The seller who listed the NFT. Only this key may cancel.
    pub seller: Pubkey,
    /// The carrier NFT's mint.
    pub mint: Pubkey,
    /// Fixed sale price in lamports. `buy` always charges exactly this
    /// stored price; client-supplied prices are never trusted.
    pub price: u64,
    /// PDA bump for the listing account. The same seeds sign the vault's
    /// token transfers on `buy` and `cancel`.
    pub bump: u8,
}
