use anchor_lang::prelude::*;

/// Seed for the listing PDA: `["listing", seller, mint]`.
#[constant]
pub const LISTING_SEED: &[u8] = b"listing";

/// Fee divisor: the fee is `price / FEE_DIVISOR`, i.e. 1% of the sale price.
/// Integer division rounds the fee DOWN; the seller receives `price - fee`,
/// so any rounding remainder goes to the seller. For prices under 100
/// lamports the fee is 0 and the seller receives the full price.
#[constant]
pub const FEE_DIVISOR: u64 = 100;

/// The fee recipient. The program pays the 1% fee to this fixed address on
/// every sale; it is never taken from client input.
///
/// Setup requirement: this address must already hold SOL (i.e. be an
/// existing, rent-exempt account) before the first sale. A fee payment to
/// a brand-new address fails, because a new system account must receive at
/// least the rent-exempt minimum (890,880 lamports) and a 1% fee is
/// usually less than that.
///
/// TODO: placeholder treasury. This is the devnet deployer's wallet, used
/// only so devnet testing has a fixed fee recipient. The owner MUST replace
/// it with the real treasury address before any mainnet deploy.
#[constant]
pub const TREASURY: Pubkey = Pubkey::from_str_const("7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7");
