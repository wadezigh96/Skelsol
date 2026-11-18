//! `skelsol-market`: fixed-price NFT escrow for the Skelsol inscription
//! marketplace.
//!
//! Follows the canonical make/take/refund escrow pattern from
//! `solana-developers/program-examples` (`tokens/escrow/anchor`), with the
//! payment leg in SOL instead of tokens:
//!
//! - `list`: the seller's carrier NFT (amount 1) moves into a PDA-owned
//!   vault; a listing account stores seller, mint, price, bump.
//! - `buy`: the buyer pays the listing price in SOL, 99% to the seller and
//!   1% to the treasury; the program PDA-signs the NFT to the buyer.
//!   Listing and vault close, rent reclaimed.
//! - `cancel`: seller only. The NFT returns to the seller; accounts close.
//!
//! The program checks the price against the listing account, never against
//! client input, and the fee recipient is a fixed address in the program
//! (see [`constants::TREASURY`]), never a client-supplied account.

pub mod constants;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo");

#[program]
pub mod skelsol_market {
    use super::*;

    pub fn list(ctx: Context<List>, price: u64) -> Result<()> {
        crate::instructions::list::handle_list(ctx, price)
    }

    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        crate::instructions::buy::handle_buy(ctx)
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        crate::instructions::cancel::handle_cancel(ctx)
    }
}
