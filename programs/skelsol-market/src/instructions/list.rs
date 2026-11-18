use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{constants::*, state::Listing};

#[derive(Accounts)]
#[instruction(price: u64)]
pub struct List<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    /// The carrier NFT's mint. Only NFT-shaped mints may be listed:
    /// 0 decimals and supply 1. (The vault invariant, exactly 1 token of
    /// this mint, is enforced by the transfer of exactly 1 token into a
    /// freshly created vault below, and re-checked on `buy`/`cancel`.)
    #[account(constraint = mint.decimals == 0 && mint.supply == 1)]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, seller.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,

    /// The seller's token account holding the NFT. It must hold exactly 1
    /// token: the whole NFT moves into escrow, never a fraction.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller,
        constraint = seller_token_account.amount == 1,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// The vault: a token account owned by the listing PDA. Only the program
    /// (signing as the PDA) can move tokens out of it, on `buy` or `cancel`.
    #[account(
        init,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = listing,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_list(ctx: Context<List>, price: u64) -> Result<()> {
    // Move the NFT (exactly 1 token) into the PDA-owned vault.
    let cpi_accounts = Transfer {
        from: ctx.accounts.seller_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token::ID, cpi_accounts);
    token::transfer(cpi_ctx, 1)?;

    ctx.accounts.listing.set_inner(Listing {
        seller: ctx.accounts.seller.key(),
        mint: ctx.accounts.mint.key(),
        price,
        bump: ctx.bumps.listing,
    });

    msg!("Listed {} for {} lamports", ctx.accounts.mint.key(), price);
    Ok(())
}
