//! Helpers shared by the market instructions.
//!
//! `buy` and `cancel` both sign vault transfers as the listing PDA and
//! close the vault, and `buy` pays out in SOL twice, so the shared
//! pieces live here instead of being copied in both handlers.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount};

use crate::{constants::*, state::Listing};

/// The listing PDA seeds, for signing vault transfers as the listing:
/// `["listing", seller, mint, bump]`. Callers wrap the result as
/// `&[&seeds[..]]` for `CpiContext::new_with_signer`.
pub fn listing_seeds(listing: &Listing) -> [&[u8]; 4] {
    [
        LISTING_SEED,
        listing.seller.as_ref(),
        listing.mint.as_ref(),
        // The bump as a one-byte slice borrowed from the listing itself,
        // not from a temporary array (which would not live long enough).
        std::slice::from_ref(&listing.bump),
    ]
}

/// Pay `lamports` in SOL from one system account to another, via a
/// system-program CPI.
pub fn transfer_sol<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: from.clone(),
        to: to.clone(),
    };
    let cpi_ctx = CpiContext::new(anchor_lang::system_program::ID, cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, lamports)
}

/// Close the vault token account, returning its rent to `destination`.
/// Signed by the listing PDA, so the caller passes the signer seeds
/// from [`listing_seeds`].
pub fn close_vault<'info>(
    vault: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let cpi_accounts = CloseAccount {
        account: vault.clone(),
        destination: destination.clone(),
        authority: authority.clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token::ID, cpi_accounts, signer_seeds);
    token::close_account(cpi_ctx)
}
