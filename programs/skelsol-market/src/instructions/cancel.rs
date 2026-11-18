use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    instructions::shared::{close_vault, listing_seeds},
    state::Listing,
};

#[derive(Accounts)]
pub struct Cancel<'info> {
    /// Only the listing's seller may cancel (`has_one = seller` below).
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Must be the listing's stored mint: a cancel for the wrong NFT
    /// fails at account validation, before anything moves.
    #[account(address = listing.mint)]
    pub mint: Account<'info, Mint>,

    /// Closes at the end of the instruction; its rent goes to the seller.
    #[account(
        mut,
        has_one = seller,
        seeds = [LISTING_SEED, listing.seller.as_ref(), listing.mint.as_ref()],
        bump = listing.bump,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,

    /// Receives the NFT back. Created if the seller closed their token
    /// account while the NFT was listed.
    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// Must hold exactly 1 token of the listing's mint: the NFT being returned.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
        constraint = vault.amount == 1,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_cancel(ctx: Context<Cancel>) -> Result<()> {
    // Return the NFT to the seller, signed by the listing PDA.
    let seeds = listing_seeds(&ctx.accounts.listing);
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.seller_token_account.to_account_info(),
        authority: ctx.accounts.listing.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token::ID, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, 1)?;

    // Close the vault, returning its rent to the seller. (The listing
    // account itself closes via the `close = seller` constraint.)
    close_vault(
        &ctx.accounts.vault.to_account_info(),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.listing.to_account_info(),
        signer_seeds,
    )?;

    msg!("Cancelled listing for {}", ctx.accounts.mint.key());
    Ok(())
}
