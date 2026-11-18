use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

use crate::{
    constants::*,
    instructions::shared::{close_vault, listing_seeds, transfer_sol},
    state::Listing,
};

#[derive(Accounts)]
pub struct Buy<'info> {
    /// Pays the listing price in SOL and receives the NFT.
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Receives `price - fee` in SOL, plus the rent of the closed listing
    /// and vault accounts. Must be the listing's stored seller.
    #[account(mut, address = listing.seller)]
    pub seller: SystemAccount<'info>,

    /// Receives the 1% fee. Must be the program's fixed treasury address;
    /// a client-supplied fee recipient is never accepted.
    #[account(mut, address = TREASURY)]
    pub treasury: SystemAccount<'info>,

    /// Must be the listing's stored mint: a buy for the wrong NFT fails
    /// at account validation, before any SOL moves.
    #[account(address = listing.mint)]
    pub mint: Account<'info, Mint>,

    /// Closes at the end of the instruction; its rent goes to the seller.
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), listing.mint.as_ref()],
        bump = listing.bump,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,

    /// Must hold exactly 1 token of the listing's mint: the NFT being sold.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = listing,
        constraint = vault.amount == 1,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Created if the buyer has no token account for this mint yet.
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy(ctx: Context<Buy>) -> Result<()> {
    // The price comes from the listing account, never from client input:
    // `buy` takes no price argument at all.
    let price = ctx.accounts.listing.price;
    // Fee rounds down (integer division); the seller gets the remainder.
    let fee = price / FEE_DIVISOR;
    let seller_amount = price - fee;

    // Pay the seller (price minus fee) in SOL.
    transfer_sol(
        &ctx.accounts.buyer.to_account_info(),
        &ctx.accounts.seller.to_account_info(),
        seller_amount,
    )?;

    // Pay the 1% fee to the treasury in SOL. Skipped when the fee is
    // zero (a price under 100 lamports): a 0-lamport transfer to a
    // treasury account that does not exist yet would fail, because a
    // new system account must receive at least the rent-exempt minimum.
    if fee > 0 {
        transfer_sol(
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            fee,
        )?;
    }

    // Release the NFT to the buyer, signed by the listing PDA.
    let seeds = listing_seeds(&ctx.accounts.listing);
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.buyer_token_account.to_account_info(),
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

    msg!(
        "Sold {} for {} lamports (fee {})",
        ctx.accounts.mint.key(),
        price,
        fee
    );
    Ok(())
}
