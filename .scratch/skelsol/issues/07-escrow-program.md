# 07: Escrow program (Anchor)

**What to build:** the one custom on-chain program, `skelsol-market`:
fixed-price NFT escrow with `list`, `buy`, and `cancel`. It follows the
canonical make/take/refund pattern from
`solana-developers/program-examples` (`tokens/escrow/anchor`), with the
payment leg in SOL: buy pays 99% to the seller and 1% to the treasury.
Deployed to devnet with a public program ID.

**Blocked by:** Anchor toolchain setup (in progress by the coordinator).
Status 19 Nov 2026: `anchor-cli 1.2.2` is installed and runs
(`~/.cargo/bin/anchor`); Solana CLI 4.3.2 and Rust 1.100.0 are installed.
Remaining step: the SBF platform-tools download failed on a GitHub API
rate limit ("rate limit exceeded, try again after 2026-11-18 18:09 UTC").
Before building, run `cargo build-sbf --tools-version v1.57
--install-only` (after 18:09 UTC); if that still fails, try building
with the already-installed platform-tools v1.54 first
(`cargo-build-sbf 4.1.0` is present). Toolchain PATH for every command:
`~/.cargo/bin:~/.local/share/solana/install/active_release/bin:~/.avm/bin`.
Set `TMPDIR=$HOME/.cargo-tmp` for cargo commands: `/tmp` is only 512 MB
and a build there runs out of disk. No code blockers.

**Status:** ready-for-agent (once the toolchain is installed)

- [ ] `list` moves the carrier NFT (amount 1) into a PDA-owned vault and stores seller, mint, price, bump
- [ ] `buy` atomically pays the seller 99% and the treasury 1% in SOL and releases the NFT to the buyer; listing and vault close with rent reclaimed
- [ ] `cancel` is seller-only and returns the NFT; accounts close
- [ ] The program checks the price against the listing account, never client input; the vault must hold exactly 1 token of the listing's mint
- [ ] Anchor tests cover happy paths, seller-only cancel, and wrong-price rejection
- [ ] Deployed to devnet; program ID, explorer link, and `solana program show` output recorded in `docs/DEPLOY.md`
- [ ] Never deployed to mainnet by the build
