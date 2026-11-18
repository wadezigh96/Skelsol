//! LiteSVM tests for `skelsol-market` (list / buy / cancel).
//!
//! These run in-process against the compiled program (`anchor test` builds
//! the `.so` first, then runs `cargo test`). No validator, no network.
//!
//! Prices used below are independent literals from the ticket, not values
//! recomputed the way the program computes them: a 1,000,000-lamport sale
//! must pay the seller 990,000 and the treasury 10,000.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    litesvm_token::{get_spl_account, CreateAssociatedTokenAccount, CreateMint, MintTo},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_associated_token_account_interface::{
        address::get_associated_token_address, program::ID as ATA_PROGRAM_ID,
    },
    spl_token_interface::{state::Account as TokenAccount, ID as TOKEN_PROGRAM_ID},
};

/// Compiled program bytes. `anchor test` builds the program before running
/// the tests, so `target/deploy/skelsol-market.so` exists by then.
fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/skelsol_market.so"
    ))
}

struct Fixture {
    svm: LiteSVM,
    seller: Keypair,
    buyer: Keypair,
    mint: Pubkey,
    seller_ata: Pubkey,
    listing: Pubkey,
    listing_bump: u8,
    vault: Pubkey,
}

impl Fixture {
    /// Fresh VM with the program loaded, a seller holding one NFT (0
    /// decimals, supply 1) in their ATA, a funded buyer, and a funded
    /// treasury.
    fn new() -> Self {
        Self::new_with(true)
    }

    /// Same as [`Fixture::new`], but the treasury is never funded: its
    /// account does not exist. A buy at a price under 100 lamports pays
    /// no fee, so it must succeed even with no treasury account.
    fn new_without_treasury() -> Self {
        Self::new_with(false)
    }

    /// Fresh VM with the program loaded, a seller holding one NFT (0
    /// decimals, supply 1) in their ATA, and a funded buyer.
    fn new_with(fund_treasury: bool) -> Self {
        let program_id = skelsol_market::id();
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, program_bytes()).unwrap();

        let seller = Keypair::new();
        let buyer = Keypair::new();
        svm.airdrop(&seller.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&buyer.pubkey(), 10_000_000_000).unwrap();
        // The treasury must already hold SOL before the first sale that
        // pays a fee: a fee payment to a brand-new address fails,
        // because a new system account must receive at least the
        // rent-exempt minimum (890,880 lamports), and a 1% fee is
        // usually less than that. In production the treasury is the
        // owner's funded wallet; here it is funded the same way.
        if fund_treasury {
            svm.airdrop(&skelsol_market::constants::TREASURY, 1_000_000_000)
                .unwrap();
        }

        let mint = CreateMint::new(&mut svm, &seller)
            .decimals(0)
            .send()
            .unwrap();
        let seller_ata = CreateAssociatedTokenAccount::new(&mut svm, &seller, &mint)
            .send()
            .unwrap();
        MintTo::new(&mut svm, &seller, &mint, &seller_ata, 1)
            .send()
            .unwrap();

        let (listing, listing_bump) = Pubkey::find_program_address(
            &[
                skelsol_market::constants::LISTING_SEED,
                seller.pubkey().as_ref(),
                mint.as_ref(),
            ],
            &program_id,
        );
        let vault = get_associated_token_address(&listing, &mint);

        Fixture {
            svm,
            seller,
            buyer,
            mint,
            seller_ata,
            listing,
            listing_bump,
            vault,
        }
    }

    fn list_instruction(&self, price: u64) -> Instruction {
        Instruction::new_with_bytes(
            skelsol_market::id(),
            &skelsol_market::instruction::List { price }.data(),
            skelsol_market::accounts::List {
                seller: self.seller.pubkey(),
                mint: self.mint,
                listing: self.listing,
                seller_token_account: self.seller_ata,
                vault: self.vault,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ATA_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn list(&mut self, price: u64) {
        let ix = self.list_instruction(price);
        // Disjoint field borrows: `svm` mutably, `seller` immutably.
        send_tx(&mut self.svm, &[ix], &[&self.seller]);
    }

    fn buy_instruction(&self, treasury: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            skelsol_market::id(),
            &skelsol_market::instruction::Buy {}.data(),
            skelsol_market::accounts::Buy {
                buyer: self.buyer.pubkey(),
                seller: self.seller.pubkey(),
                treasury,
                mint: self.mint,
                listing: self.listing,
                vault: self.vault,
                buyer_token_account: self.buyer_ata(),
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ATA_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn buyer_ata(&self) -> Pubkey {
        get_associated_token_address(&self.buyer.pubkey(), &self.mint)
    }

    fn cancel_instruction(&self, signer: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            skelsol_market::id(),
            &skelsol_market::instruction::Cancel {}.data(),
            skelsol_market::accounts::Cancel {
                seller: signer,
                mint: self.mint,
                listing: self.listing,
                seller_token_account: get_associated_token_address(&signer, &self.mint),
                vault: self.vault,
                token_program: TOKEN_PROGRAM_ID,
                associated_token_program: ATA_PROGRAM_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// A second NFT mint plus a vault-style ATA owned by the listing PDA
    /// holding 1 token of it: the accounts a mismatched-mint buy/cancel
    /// needs, so the mint address constraint is the only check that
    /// can fail.
    fn wrong_mint_setup(&mut self) -> (Pubkey, Pubkey) {
        let mint = CreateMint::new(&mut self.svm, &self.seller)
            .decimals(0)
            .send()
            .unwrap();
        let vault = CreateAssociatedTokenAccount::new(&mut self.svm, &self.seller, &mint)
            .owner(&self.listing)
            .send()
            .unwrap();
        MintTo::new(&mut self.svm, &self.seller, &mint, &vault, 1)
            .send()
            .unwrap();
        (mint, vault)
    }

    fn listing_state(&self) -> skelsol_market::state::Listing {
        let account = self.svm.get_account(&self.listing).unwrap();
        let mut data: &[u8] = &account.data;
        skelsol_market::state::Listing::try_deserialize(&mut data).unwrap()
    }

    fn token_balance(&self, account: &Pubkey) -> u64 {
        let state: TokenAccount = get_spl_account(&self.svm, account).unwrap();
        state.amount
    }

    fn lamports(&self, account: &Pubkey) -> u64 {
        self.svm.get_account(account).unwrap().lamports
    }

    /// Lamports of an account that may not exist yet (e.g. the treasury
    /// before its first fee): 0 when the account is absent.
    fn lamports_or_zero(&self, account: &Pubkey) -> u64 {
        self.svm
            .get_account(account)
            .map(|account| account.lamports)
            .unwrap_or(0)
    }
}

fn send_tx(
    svm: &mut LiteSVM,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> litesvm::types::TransactionMetadata {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(instructions, Some(&signers[0].pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(meta) => meta,
        Err(err) => panic!(
            "transaction failed: {:?}\nlogs:\n{}",
            err.err,
            err.meta.pretty_logs()
        ),
    }
}

fn send_tx_expect_error(
    svm: &mut LiteSVM,
    instructions: &[Instruction],
    signers: &[&Keypair],
) -> FailedTransactionMetadata {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(instructions, Some(&signers[0].pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    match svm.send_transaction(tx) {
        Ok(meta) => panic!(
            "expected transaction to fail, but it succeeded: {:?}",
            meta.logs
        ),
        Err(err) => err,
    }
}

#[test]
fn list_moves_nft_into_vault_and_stores_listing() {
    let mut fx = Fixture::new();
    let price = 1_000_000u64;

    fx.list(price);

    // Listing stores seller, mint, price, bump.
    let listing = fx.listing_state();
    assert_eq!(listing.seller, fx.seller.pubkey());
    assert_eq!(listing.mint, fx.mint);
    assert_eq!(listing.price, price);
    assert_eq!(listing.bump, fx.listing_bump);

    // Vault holds exactly 1 token of the listing's mint, owned by the PDA.
    let vault: TokenAccount = get_spl_account(&fx.svm, &fx.vault).unwrap();
    assert_eq!(vault.amount, 1);
    assert_eq!(vault.mint, fx.mint);
    assert_eq!(vault.owner, fx.listing);

    // The seller no longer holds the NFT.
    assert_eq!(fx.token_balance(&fx.seller_ata), 0);
}

#[test]
fn list_rejects_non_nft_mint() {
    let mut fx = Fixture::new();

    // A fungible-shaped mint (2 decimals) must not be listable, even with
    // 1 token in the seller's account.
    let mint = CreateMint::new(&mut fx.svm, &fx.seller)
        .decimals(2)
        .send()
        .unwrap();
    let ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &fx.seller, &mint)
        .send()
        .unwrap();
    MintTo::new(&mut fx.svm, &fx.seller, &mint, &ata, 1)
        .send()
        .unwrap();

    let (listing, _) = Pubkey::find_program_address(
        &[
            skelsol_market::constants::LISTING_SEED,
            fx.seller.pubkey().as_ref(),
            mint.as_ref(),
        ],
        &skelsol_market::id(),
    );
    let vault = get_associated_token_address(&listing, &mint);
    let ix = Instruction::new_with_bytes(
        skelsol_market::id(),
        &skelsol_market::instruction::List { price: 1_000_000 }.data(),
        skelsol_market::accounts::List {
            seller: fx.seller.pubkey(),
            mint,
            listing,
            seller_token_account: ata,
            vault,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ATA_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&fx.seller]);
    assert!(
        err.meta
            .logs
            .iter()
            .any(|log| log.contains("AnchorError") || log.contains("constraint")),
        "expected an Anchor constraint failure, got logs:\n{}",
        err.meta.pretty_logs()
    );
}

#[test]
fn buy_pays_seller_and_treasury_and_releases_nft() {
    let mut fx = Fixture::new();
    // Independent literals: a 1,000,000-lamport sale pays the seller
    // 990,000 (99%) and the treasury 10,000 (1%).
    let price = 1_000_000u64;
    let fee = 10_000u64;
    let seller_proceeds = 990_000u64;

    fx.list(price);

    // Pre-create the buyer's token account so the buy itself only moves
    // the price (plus the transaction fee), keeping the balance math exact.
    let buyer_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &fx.buyer, &fx.mint)
        .send()
        .unwrap();

    let treasury = skelsol_market::constants::TREASURY;
    let seller_before = fx.lamports(&fx.seller.pubkey());
    let buyer_before = fx.lamports(&fx.buyer.pubkey());
    let treasury_before = fx.lamports_or_zero(&treasury);
    let listing_rent = fx.lamports(&fx.listing);
    let vault_rent = fx.lamports(&fx.vault);

    let ix = fx.buy_instruction(treasury);
    let meta = send_tx(&mut fx.svm, &[ix], &[&fx.buyer]);

    // Buyer paid exactly the listing price plus the transaction fee.
    assert_eq!(
        fx.lamports(&fx.buyer.pubkey()),
        buyer_before - price - meta.fee
    );
    // Seller got price minus fee, plus the reclaimed rent of both accounts.
    assert_eq!(
        fx.lamports(&fx.seller.pubkey()),
        seller_before + seller_proceeds + listing_rent + vault_rent
    );
    // Treasury got exactly the 1% fee.
    assert_eq!(fx.lamports(&treasury), treasury_before + fee);

    // Buyer received the NFT; listing and vault are closed.
    assert_eq!(fx.token_balance(&buyer_ata), 1);
    assert!(fx.svm.get_account(&fx.listing).is_none());
    assert!(fx.svm.get_account(&fx.vault).is_none());
}

#[test]
fn buy_rounds_fee_down_and_seller_gets_remainder() {
    let mut fx = Fixture::new();
    // 1,000,001 / 100 = 10,000.01, so the fee rounds down to 10,000 and
    // the seller receives the remainder: 990,001.
    let price = 1_000_001u64;

    fx.list(price);
    let buyer_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &fx.buyer, &fx.mint)
        .send()
        .unwrap();

    let treasury = skelsol_market::constants::TREASURY;
    let seller_before = fx.lamports(&fx.seller.pubkey());
    let treasury_before = fx.lamports(&treasury);
    let listing_rent = fx.lamports(&fx.listing);
    let vault_rent = fx.lamports(&fx.vault);

    let ix = fx.buy_instruction(treasury);
    send_tx(&mut fx.svm, &[ix], &[&fx.buyer]);

    assert_eq!(fx.lamports(&treasury), treasury_before + 10_000);
    assert_eq!(
        fx.lamports(&fx.seller.pubkey()),
        seller_before + 990_001 + listing_rent + vault_rent
    );
    assert_eq!(fx.token_balance(&buyer_ata), 1);
}

#[test]
fn buy_at_price_under_100_lamports_succeeds_without_treasury() {
    // No treasury funding at all: the treasury account does not exist.
    let mut fx = Fixture::new_without_treasury();
    // 50 lamports: the 1% fee rounds down to 0, so the seller receives
    // the full price and no fee transfer happens at all.
    let price = 50u64;

    fx.list(price);
    let buyer_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &fx.buyer, &fx.mint)
        .send()
        .unwrap();

    let treasury = skelsol_market::constants::TREASURY;
    assert!(fx.svm.get_account(&treasury).is_none());
    let seller_before = fx.lamports(&fx.seller.pubkey());
    let buyer_before = fx.lamports(&fx.buyer.pubkey());
    let listing_rent = fx.lamports(&fx.listing);
    let vault_rent = fx.lamports(&fx.vault);

    let ix = fx.buy_instruction(treasury);
    let meta = send_tx(&mut fx.svm, &[ix], &[&fx.buyer]);

    // Buyer paid exactly the price plus the transaction fee; seller got
    // the full price plus the reclaimed rent of both accounts.
    assert_eq!(
        fx.lamports(&fx.buyer.pubkey()),
        buyer_before - price - meta.fee
    );
    assert_eq!(
        fx.lamports(&fx.seller.pubkey()),
        seller_before + price + listing_rent + vault_rent
    );
    // The treasury still does not exist: no 0-lamport fee transfer was
    // attempted (one would have failed, because a new system account
    // must receive at least the rent-exempt minimum).
    assert!(fx.svm.get_account(&treasury).is_none());

    // Buyer received the NFT; listing and vault are closed.
    assert_eq!(fx.token_balance(&buyer_ata), 1);
    assert!(fx.svm.get_account(&fx.listing).is_none());
    assert!(fx.svm.get_account(&fx.vault).is_none());
}

#[test]
fn buy_rejects_mismatched_mint() {
    let mut fx = Fixture::new();
    fx.list(1_000_000);
    let (wrong_mint, wrong_vault) = fx.wrong_mint_setup();

    // A buy that passes a different mint than the listing's: the vault
    // holds 1 token of that mint, so the only failing check is the mint
    // address constraint.
    let ix = Instruction::new_with_bytes(
        skelsol_market::id(),
        &skelsol_market::instruction::Buy {}.data(),
        skelsol_market::accounts::Buy {
            buyer: fx.buyer.pubkey(),
            seller: fx.seller.pubkey(),
            treasury: skelsol_market::constants::TREASURY,
            mint: wrong_mint,
            listing: fx.listing,
            vault: wrong_vault,
            buyer_token_account: get_associated_token_address(&fx.buyer.pubkey(), &wrong_mint),
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ATA_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&fx.buyer]);
    assert!(
        err.meta
            .logs
            .iter()
            .any(|log| log.contains("ConstraintAddress")),
        "expected a mint address constraint failure, got logs:\n{}",
        err.meta.pretty_logs()
    );

    // Nothing moved.
    assert_eq!(fx.listing_state().price, 1_000_000);
    assert_eq!(fx.token_balance(&fx.vault), 1);
}

#[test]
fn buy_rejects_buyer_who_cannot_pay_listed_price() {
    let mut fx = Fixture::new();
    let price = 1_000_000u64;
    fx.list(price);

    // A buyer holding less than the price. 950,000 lamports is above the
    // rent-exempt minimum for a system account (890,880), so the account
    // exists, but below the 1,000,000-lamport price, so the payment fails.
    // Their token account is pre-created and paid for by the seller, so
    // the only thing that can fail is the price itself: the program
    // charges the stored price and refuses a buyer who cannot pay it.
    let poor_buyer = Keypair::new();
    fx.svm.airdrop(&poor_buyer.pubkey(), 950_000).unwrap();
    let poor_ata = CreateAssociatedTokenAccount::new(&mut fx.svm, &fx.seller, &fx.mint)
        .owner(&poor_buyer.pubkey())
        .send()
        .unwrap();

    let ix = Instruction::new_with_bytes(
        skelsol_market::id(),
        &skelsol_market::instruction::Buy {}.data(),
        skelsol_market::accounts::Buy {
            buyer: poor_buyer.pubkey(),
            seller: fx.seller.pubkey(),
            treasury: skelsol_market::constants::TREASURY,
            mint: fx.mint,
            listing: fx.listing,
            vault: fx.vault,
            buyer_token_account: poor_ata,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ATA_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&poor_buyer]);
    assert!(
        err.meta.logs.iter().any(|log| log.contains("nsufficient")),
        "expected an insufficient-funds failure, got logs:\n{}",
        err.meta.pretty_logs()
    );

    // Nothing moved: the listing is intact and the vault still holds the NFT.
    assert_eq!(fx.listing_state().price, price);
    assert_eq!(fx.token_balance(&fx.vault), 1);
    assert_eq!(fx.token_balance(&poor_ata), 0);
}

#[test]
fn buy_rejects_wrong_treasury_account() {
    let mut fx = Fixture::new();
    fx.list(1_000_000);

    // A client-supplied fee recipient that is not the program's fixed
    // treasury address must be rejected.
    let fake_treasury = Keypair::new().pubkey();
    let ix = fx.buy_instruction(fake_treasury);
    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&fx.buyer]);
    assert!(
        err.meta
            .logs
            .iter()
            .any(|log| log.contains("AnchorError") || log.contains("constraint")),
        "expected an Anchor constraint failure, got logs:\n{}",
        err.meta.pretty_logs()
    );

    // Nothing moved.
    assert_eq!(fx.listing_state().price, 1_000_000);
    assert_eq!(fx.token_balance(&fx.vault), 1);
}

#[test]
fn cancel_returns_nft_to_seller_and_closes_accounts() {
    let mut fx = Fixture::new();
    fx.list(1_000_000);

    let seller_before = fx.lamports(&fx.seller.pubkey());
    let listing_rent = fx.lamports(&fx.listing);
    let vault_rent = fx.lamports(&fx.vault);

    let ix = fx.cancel_instruction(fx.seller.pubkey());
    let meta = send_tx(&mut fx.svm, &[ix], &[&fx.seller]);

    // NFT back with the seller; listing and vault closed, rent reclaimed
    // (minus the transaction fee the seller paid as fee payer).
    assert_eq!(fx.token_balance(&fx.seller_ata), 1);
    assert!(fx.svm.get_account(&fx.listing).is_none());
    assert!(fx.svm.get_account(&fx.vault).is_none());
    assert_eq!(
        fx.lamports(&fx.seller.pubkey()),
        seller_before + listing_rent + vault_rent - meta.fee
    );
}

#[test]
fn cancel_rejects_mismatched_mint() {
    let mut fx = Fixture::new();
    fx.list(1_000_000);
    let (wrong_mint, wrong_vault) = fx.wrong_mint_setup();

    // A cancel that passes a different mint than the listing's: the
    // vault holds 1 token of that mint, so the only failing check is
    // the mint address constraint.
    let ix = Instruction::new_with_bytes(
        skelsol_market::id(),
        &skelsol_market::instruction::Cancel {}.data(),
        skelsol_market::accounts::Cancel {
            seller: fx.seller.pubkey(),
            mint: wrong_mint,
            listing: fx.listing,
            seller_token_account: get_associated_token_address(&fx.seller.pubkey(), &wrong_mint),
            vault: wrong_vault,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: ATA_PROGRAM_ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&fx.seller]);
    assert!(
        err.meta
            .logs
            .iter()
            .any(|log| log.contains("ConstraintAddress")),
        "expected a mint address constraint failure, got logs:\n{}",
        err.meta.pretty_logs()
    );

    // Nothing moved: the listing is intact and the vault still holds the NFT.
    assert_eq!(fx.listing_state().price, 1_000_000);
    assert_eq!(fx.token_balance(&fx.vault), 1);
    assert_eq!(fx.token_balance(&fx.seller_ata), 0);
}

#[test]
fn cancel_rejects_non_seller() {
    let mut fx = Fixture::new();
    fx.list(1_000_000);

    // Anyone but the seller must not be able to cancel.
    let ix = fx.cancel_instruction(fx.buyer.pubkey());
    let err = send_tx_expect_error(&mut fx.svm, &[ix], &[&fx.buyer]);
    assert!(
        err.meta
            .logs
            .iter()
            .any(|log| log.contains("AnchorError") || log.contains("constraint")),
        "expected an Anchor constraint failure, got logs:\n{}",
        err.meta.pretty_logs()
    );

    // Nothing moved: the listing is intact and the vault still holds the NFT.
    assert_eq!(fx.listing_state().price, 1_000_000);
    assert_eq!(fx.token_balance(&fx.vault), 1);
    assert_eq!(fx.token_balance(&fx.seller_ata), 0);
}
