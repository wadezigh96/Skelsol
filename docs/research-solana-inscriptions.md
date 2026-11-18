# Research: SPL-20 Inscriptions on Solana — Mint Framework + Escrow Marketplace

**Date:** 19 November 2026
**Purpose:** Ground the Skelsol build (SPL-20-style inscription mint framework + fixed-price
NFT escrow marketplace) in primary sources: official docs, source code, and specs.
**Method note:** Every factual claim below carries its source URL. Where a primary source
could not be found, that is stated explicitly and the claim is marked as coming from a
secondary source or as the author's engineering judgment. One source fetch failed:
`https://solana.com/docs/core/rent` returned HTTP 429 when read on 19 Nov 2026, so the rent
formula is cited to the Solana docs URL plus secondary sources that quote it verbatim.

---

## 1. LibrePlex SPL-20 / inscriptions protocol

### 1.1 The SPL-20 JSON format is a convention, not a published spec

There is **no formal SPL-20 specification document published by LibrePlex** that this
research could locate. The LibrePlex documentation site's quickstart covers minting NFTs
and groups via `@libreplex/sdk` and does not document an SPL-20 JSON format at all.

- LibrePlex docs (quickstart): https://libreplex.github.io/libreplex-program-library/

The canonical JSON shape is instead a community convention copied from Bitcoin's BRC-20,
established in practice by SOLS, the first SPL-20 token (launched November 2023). The
mint inscription used for SOLS was:

```json
{"p":"spl-20","op":"mint","tick":"sols","amt":"1000"}
```

- SOLS mint text, quoted in a contemporary minting tutorial:
  https://www.aicoin.com/en/article/375742
- Same shape (`{"p":"spl-20","op":"mint","tick":"lamp","amt":"100000"}`) for the LAMP
  token: https://www.techflowpost.com/en-US/article/14646

Field meanings (by BRC-20 analogy, confirmed by the examples above):

| Field | Meaning |
|-------|---------|
| `p` | Protocol identifier, always `"spl-20"` |
| `op` | Operation: `mint` is the documented one; `deploy` / `transfer` follow the BRC-20 pattern by analogy, not by any LibrePlex spec this research found |
| `tick` | Token ticker (lowercase in the SOLS/LAMP examples) |
| `amt` | Amount, as a **string**, not a number |

**Honest consequence:** because there is no spec body and no on-chain enforcement, an
SPL-20 token's "balances" exist only as the output of an **off-chain indexer** that replays
inscriptions and applies its own validity rules. LibrePlex itself operated the
inscription/verification websites during the 2023 frenzy, and inscriptions had to pass a
"verification" (double-lock) step to be included in the index range
(https://www.techflowpost.com/en-US/article/14646). Validity is indexer-defined, not
program-defined. Any new project using this JSON shape must either run its own indexer
rules or state plainly that the JSON is a record, not a ledger entry.

### 1.2 Where the JSON text lives on-chain (LibrePlex)

In the real LibrePlex protocol the JSON (or image bytes) lives in **account state** owned
by the LibrePlex Inscriptions program — not in transaction logs. The program's Rust API
shows the account model: an `Inscription` / `InscriptionV3` account plus an
`InscriptionData` account that holds the bytes, written via dedicated instructions.

- Program source (`lib.rs`), `declare_id!("inscokhJarcjaEs59QbQ7hYjrKz25LEPRfCbP8EmdUp")`,
  instructions `create_inscription_v3`, `write_to_inscription_v3`,
  `resize_inscription_v3`, `make_inscription_immutable_v3`,
  `create_ghost_root_inscription`, `set_validation_hash`, `migrate_to_v3`,
  `claim_excess_rent`, `create_inscription_rank_page`:
  https://docs.rs/libreplex_inscriptions/latest/src/libreplex_inscriptions/lib.rs.html
- `WriteToInscription` accounts struct (`inscription`, `inscription2: InscriptionV3`,
  `inscription_data`):
  https://docs.rs/libreplex_inscriptions/latest/libreplex_inscriptions/instructions/write_to_inscription/struct.WriteToInscription.html
- `CreateGhostRootInscription` accounts (`inscription_summary`, `inscription_data`,
  `inscription_v3`):
  https://docs.rs/libreplex_inscriptions/latest/libreplex_inscriptions/instructions/ghost/struct.CreateGhostRootInscription.html

Program ID (primary source, from the crate source above):

```
inscokhJarcjaEs59QbQ7hYjrKz25LEPRfCbP8EmdUp
```

Repository: https://github.com/LibrePlex/libreplex-program-library (public, MIT, created
23 May 2023, 63 stars at time of reading). The crate is `libreplex_inscriptions` v0.5.1,
built on Anchor ~0.30 (https://docs.rs/crate/libreplex_inscriptions/latest/source/Cargo.toml).

Key mechanics of the LibrePlex design:

- An inscription is a PDA associated with an NFT; the inscription account stores arbitrary
  data (image bytes or serialized JSON). Inscriptions are ranked by creation order, via
  rank pages (`create_inscription_rank_page` in the source above).
- Inscribing requires update authority over the NFT (the "as update authority" instruction
  family in the companion `libreplex_legacy` crate makes the authority model explicit):
  https://docs.rs/libreplex_legacy/latest/libreplex_legacy/instructions/inscribe_legacy_metadata_as_uauth/struct.InscribeLegacyMetadataAsUauth.html
- Inscriptions can be made immutable (`make_inscription_immutable`, `MakeImmutable` in
  `libreplex_legacy`) and carry an optional validation hash (`set_validation_hash`).
- Secondary sources add: the on-chain program is upgradeable with an active upgrade
  authority and has no verified build (Orb explorer listing — secondary, verify on-chain
  before relying on it):
  https://orbmarkets.io/address/inscokhJarcjaEs59QbQ7hYjrKz25LEPRfCbP8EmdUp/history

### 1.3 What the NFT carrier looks like

The carrier is an ordinary Solana NFT (an SPL mint with supply 1 and 0 decimals, plus a
metadata account). In the original 2023 flow users first deployed/minted an NFT and then
inscribed it via the LibrePlex site
(https://www.techflowpost.com/en-US/article/14646). LibrePlex also ships its own
metadata program (`libreplex_metadata`) as an alternative to Metaplex Token Metadata, but
the original SPL-20 carriers were standard NFTs; the inscription is an additional account
linked to the mint, not a different kind of token.

### 1.4 Is LibrePlex still the reference implementation in 2026?

**No — not as a living reference.** Findings:

- LibrePlex is the historical originator of SPL-20 (SOLS, November 2023) and its program
  is still deployed at the ID above, with public source. That is the extent of the
  defensible claim.
- Its docs site does not document SPL-20 at all (see §1.1), and its crate is on the
  Anchor 0.30 era while the Anchor ecosystem has moved to 1.x in 2026 (Anchor 1.0.0,
  April 2026, per https://docs.chainstack.com/docs/solana-escrow-pattern).
- Metaplex now ships its **own** maintained Inscriptions program (`mpl-inscription`,
  Umi SDK `@metaplex-foundation/mpl-inscription`, instructions `initializeFromMint` /
  `writeData` / `fetchInscription`), documented as the current Metaplex path for
  on-chain inscription data attached to an NFT:
  https://www.metaplex.com/docs/smart-contracts/inscription/getting-started/js
  and https://www.metaplex.com/docs/smart-contracts/inscription/write
- There is no standards body for SPL-20; "SPL-20" today means "the LibrePlex-originated
  JSON convention," and any compatibility claim must be tested against a specific
  indexer, not against a spec.

**Bottom line for Skelsol:** do not present the project as "implementing LibrePlex
SPL-20" unless it actually writes LibrePlex inscription accounts. A memo-based JSON
record is honestly described as **"SPL-20-style"** (see §7).

---

## 2. The Memo program (spl-memo)

### 2.1 Program IDs

| Version | Program ID | Note |
|---------|-----------|------|
| Memo v3 (current, signed) | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | Validates that provided accounts are signers |
| Memo v1 (legacy, unsigned) | `Memo1UhkJBfCVL82tnuFCbfZfWN7eFoGzPCz6DVCo1M` | No signer enforcement |
| p-memo (Pinocchio rewrite) | `Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH` | Much cheaper in compute units; newer deployment |

- The v3 ID appears in Solana's own docs, in the example transaction log
  (`Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]`,
  `Program log: Memo (len 46): "Payment for services rendered - Invoice #12345"`):
  https://solana.com/docs/payments/send-payments/payment-with-memo
- The v1 ID and the v1/v3 distinction are documented at:
  https://www.in-solana.com/programs/memo/ (secondary reference page)
- p-memo and its address, with the compute comparison (~513 CU vs ~13,525 CU for a
  single-signer memo): https://www.quicknode.com/guides/solana-development/getting-started/how-to-use-the-solana-memo-program
  (secondary guide; the program itself is a first-party-style reimplementation, but
  treat the CU figures as guide-measured, not spec-guaranteed)

**Recommendation:** use the canonical v3 program
`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`. It is the one Solana's docs use, the one
explorers parse, and the one every indexer understands. p-memo is an optimization, not a
compatibility win.

### 2.2 How to attach a memo

The Memo program "validates a string of UTF-8 encoded characters and verifies that any
accounts provided are signers of the transaction. The program also logs the memo, as well
as any verified signer addresses, to the transaction log, so that anyone can easily
observe memos and know they were approved by zero or more addresses by inspecting the
transaction log from a trusted provider."

- https://www.solana-program.com/docs/memo

Mechanics:

- A memo is a single instruction whose **instruction data is the raw UTF-8 text**; no
  accounts are required. If accounts are provided, all of them must be signers, and the
  program logs `Signed by <address>` for each.
  (https://www.solana-program.com/docs/memo)
- Current Solana docs (Solana Kit) use `getAddMemoInstruction({ memo })` from
  `@solana-program/memo`, combined in one transaction with the other instructions:
  https://solana.com/docs/payments/send-payments/payment-with-memo
- The Rust crate `spl-memo` provides a `build_memo()` helper:
  https://docs.rs/crate/spl-memo/3.0.1/source/src/processor.rs
  (the processor source shows the UTF-8 validation and logging logic).
- With `@solana/web3.js` v1 the same thing is a plain `TransactionInstruction` with
  `programId` = the Memo program ID, `keys: []`, and `data` = the UTF-8 bytes. This is
  standard usage, shown for example at https://docs.drip.tools/swap/memo (secondary).

### 2.3 Size limits

- **566 bytes** maximum for an unsigned memo instruction ("As of v1.5.1, an unsigned
  instruction can support single-byte UTF-8 of up to 566 bytes"):
  https://www.solana-program.com/docs/memo
- The binding constraint is the transaction size: a Solana transaction must fit in a
  single packet of **1,232 bytes** (`PACKET_DATA_SIZE` = 1,232 bytes):
  https://solana.com/docs/core/transactions/transaction-pipeline
  (also stated in the Solana Foundation's deploying docs:
  https://github.com/solana-foundation/developer-content/blob/HEAD/docs/programs/deploying.md)
- A compact SPL-20 JSON record is ~50–90 bytes
  (e.g. `{"p":"spl-20","op":"mint","tick":"ghost","amt":"1"}` is 44 bytes), so it fits
  comfortably in a memo alongside a mint transaction — but the memo shares the 1,232-byte
  budget with every other instruction in the transaction, so a combined
  mint + memo transaction must stay under the cap (in practice fine for a single NFT
  mint; verify by serializing before sending).

### 2.4 Is a memo-based inscription a legitimate, verifiable on-chain record?

**Yes, with precisely understood limits.** Solana's docs state: "These memos are
permanently recorded onchain and visible in transaction logs" and "These logs are indexed
by explorers and RPC providers, making memos searchable."
(https://solana.com/docs/payments/send-payments/payment-with-memo)

What that does and does not mean:

- **Verifiable:** anyone with the transaction signature can fetch the transaction
  (`getTransaction`, `jsonParsed`) and read the memo from `meta.logMessages`, together
  with the fee payer / signer — proving who wrote what, and when (slot/time). The Solana
  docs page demonstrates exactly this read-back.
- **Permanent in the ledger:** the memo is part of a confirmed transaction, so it is as
  durable as the chain's transaction history.
- **Not account state:** a memo lives in transaction history/logs, not in an account.
  No on-chain program can read it, and it cannot be queried with `getAccountInfo` — only
  by scanning transactions (via RPC `getSignaturesForAddress`, an indexer, or an
  explorer). Long-range availability depends on archival RPC/explorer retention; a
  program that needs to *prove* a memo on-chain cannot do so.
- **Not self-binding:** a memo does not by itself attach to an NFT. The binding must be
  established by convention — e.g. the memo is in the same transaction as the NFT mint,
  or the JSON includes the mint address. State this convention explicitly in the
  project docs; do not imply the chain enforces it.
- **Cost:** the memo instruction itself costs compute only (Solana's docs example log
  shows ~18k CU for a 46-character memo with the classic program); the transaction's
  base fee is 5,000 lamports per signature. Either way the memo is effectively free
  relative to NFT rent (see §3.3).

---

## 3. Metaplex Token Metadata: minting one NFT from a browser/JS client

### 3.1 Important 2026 status: Token Metadata is legacy; Core is recommended

Metaplex's own docs, verbatim: **"Token Metadata is a legacy program. It remains
supported, but is not recommended for new projects. Use Core instead."**

- https://www.metaplex.com/docs/smart-contracts/token-metadata/getting-started/umi

Metaplex Core uses a single-account design ("reducing minting costs and improving Solana
network load compared to alternatives") with a flexible plugin system:

- https://www.metaplex.com/docs/smart-contracts/core/guides/javascript/how-to-create-a-core-collection-with-javascript

Token Metadata nevertheless remains fully supported, is the most widely read standard by
wallets, explorers, and marketplaces, and is the right choice when maximum ecosystem
compatibility matters (e.g. a marketplace whose listings must display everywhere). The
choice is a genuine trade-off, not a mistake either way; §7 gives a recommendation.

### 3.2 Program IDs and account model

- **Token Metadata program ID (same on mainnet, devnet, testnet):**
  `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`
  - https://rareskills.io/post/metaplex-token-metadata
  - https://www.in-solana.com/programs/metaplex-token-metadata/
  - Canonical-address constant (Dart client docs, stating mainnet/devnet/testnet):
    https://pub.dev/documentation/solana_kit_mpl_token_metadata/latest/solana_kit_mpl_token_metadata/mplTokenMetadataProgramAddress-constant.html
- **SPL Token program ID:** `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
  (https://www.alchemii.io/blog/what-is-metaplex-token-metadata — secondary)
- **Metaplex Core program ID:** `CoREENxT6tW1HoK8yfYWXSzaXUcGUimvH2vQJ55jEo`
  (https://solana.codeguides.io/nfts-metaplex/nft-basics-on-solana/ — secondary)

An NFT under Token Metadata is three things at once:

1. An SPL **mint account** with supply 1 and 0 decimals.
2. A **metadata account** (PDA, seeds `["metadata", token_metadata_program_id, mint]`)
   holding name, symbol, URI (pointing at off-chain JSON), creators, and royalty
   (`sellerFeeBasisPoints`).
3. A **master edition account** (PDA), which marks the token as a true 1-of-1 and caps
   supply.

- PDA derivation and account roles:
  https://rareskills.io/post/metaplex-token-metadata and
  https://solana.codeguides.io/nfts-metaplex/token-metadata/
- The mint → metadata → master-edition flow (mint 0 decimals, mint exactly 1 token,
  CPI `create_metadata_accounts_v3`, CPI `create_master_edition_v3`):
  http://sol.college/lessons/gree/

### 3.3 Current recommended JS path (Umi SDK)

Per Metaplex's docs, the current JS path is the **Umi SDK**
(`@metaplex-foundation/mpl-token-metadata` on the Umi framework):

- Install: `@metaplex-foundation/umi`, `@metaplex-foundation/umi-bundle-defaults`,
  `@solana/web3.js@1`, `@metaplex-foundation/mpl-token-metadata`.
- Create the client: `createUmi('https://api.devnet.solana.com').use(mplTokenMetadata())`.
- Mint: `createNft(umi, { mint, name, uri, sellerFeeBasisPoints })` with
  `mint = generateSigner(umi)`, then `.sendAndConfirm(umi)`.
- Read back: `fetchDigitalAsset(umi, mintAddress)`.
- https://www.metaplex.com/docs/smart-contracts/token-metadata/getting-started/umi

Notes for a no-build static site (author's judgment, not a Metaplex claim): the Umi
packages are npm ESM modules with no IIFE browser bundle, so a plain HTML/JS page must
load them through an ESM CDN (e.g. esm.sh / jsDelivr ESM) with an import map, or the
page must construct the Token Metadata instructions manually with `@solana/web3.js`
(`CreateMetadataAccountV3` / `CreateMasterEditionV3` instruction builders). Either is
workable; the ESM-CDN route is less code, the manual route has fewer moving parts. The
off-chain metadata JSON itself must be hosted somewhere (the `uri` field); Arweave/IPFS
are the durable choices — a point the Metaplex guides assume throughout.

### 3.4 Approximate SOL cost (rent) for one NFT mint

Rent on Solana is a **refundable storage deposit**, not a fee: "Ongoing rent collection
is disabled; the minimum works as a deposit that is returned in full when the account is
closed." The documented formula is:

```
minimum_balance = (data_size + 128) × lamports_per_byte
```

with `lamports_per_byte` historically 6,960 (= 3,480 lamports/byte-year × 2 years).

- Formula and worked examples, quoting the Solana docs:
  https://brain.ckelley.dev/concepts/Solana-Account-Model
  (citing https://solana.com/docs/core/accounts)
- Formula and the 128-byte overhead:
  https://www.alchemii.io/blog/free-mint-solana-token
  (citing https://solana.com/docs/core/rent — this page returned HTTP 429 when read
  directly on 19 Nov 2026, so the formula is corroborated rather than directly read)

**Cost table at the classic 6,960 lamports/byte rate:**

| Account | Size | Rent-exempt deposit |
|---------|------|---------------------|
| Mint account | 82 bytes | (82+128) × 6,960 = 1,461,600 lamports ≈ **0.00146 SOL** |
| Metadata account | variable (name/URI/creators) | ≈ **0.0144 SOL** (commonly cited figure) |
| Master edition account | fixed, small | ≈ **0.0029 SOL** |
| Holder ATA (token account) | 165 bytes | (165+128) × 6,960 = 2,039,280 lamports ≈ **0.00204 SOL** |
| **Total (approx.)** | | **≈ 0.021 SOL**, plus ~0.00001–0.00005 SOL in transaction fees |

- Mint 82 bytes / ATA 165 bytes and the computed lamport figures:
  https://www.alchemii.io/blog/free-mint-solana-token
- Metadata account ≈ 0.0144 SOL:
  https://www.alchemii.io/blog/what-is-metaplex-token-metadata
- Independent total of ~0.022 SOL for a Token Metadata NFT:
  https://github.com/anagrambuild/solclaw/blob/HEAD/container/skills/metaplex/SKILL.md
  (secondary)

**⚠️ The per-byte rate is changing under SIMD-0437 (2026).** The rate is being cut ~90%
in five steps, from 6,960 toward 696 lamports/byte. Step 1 activated on mainnet
3 Sep 2026 (→ 6,333); step 2 activated 11 Sep 2026 (→ 5,080). Steps 3–5 (→ 2,575 /
1,322 / 696) were expected with Agave 4.4 around November 2026, but as of early
November 2026 they were still described as pending, and each step can be paused.

- https://raydium.main-kill-isr.mintlify.me/solana-fundamentals/rent-and-reclaimable-rent
- https://en.coin-turk.com/solana-account-rent-now-refundable-minimum-falls-to-5080-lamports-per-byte/
- https://coinstats.app/news/3f253fd387d6c2c2e48a0a199c8423ec8b0fbd82671e8b66519c1ef20a6c8d7a_Solana-Account-Rent-Explained-Costs-Rules-and-Refunds/

At the 5,080 rate the same NFT costs ≈ 0.015 SOL; at the final 696 rate it would cost
≈ 0.002 SOL. **Do not hard-code rent figures.** Query the live value with the
`getMinimumBalanceForRentExemption(size)` RPC method (or `solana rent <bytes>`) at
build/run time. The same rent schedule applies identically on devnet and mainnet — the
difference is only that devnet SOL is free test currency (see §5).

---

## 4. Anchor escrow pattern (fixed-price NFT sale for SOL)

### 4.1 The canonical pattern: make / take / refund

The standard Anchor escrow has three instructions. The reference implementation on
Anchor's own examples site is a token-for-token swap, but the account mechanics are
exactly the ones a fixed-price NFT marketplace needs:

- https://examples.anchor-lang.com/docs/non-custodial-escrow

How it works there:

1. **Initialize (list):** creates an `Escrow` PDA (seeds `["escrow", seller]`) storing
   the seller, the escrowed-token-account address, the wanted mint, and the wanted
   amount; creates an escrowed token account with `token::authority = escrow` (the PDA
   owns it); transfers the seller's tokens into it via CPI to the Token program.
2. **Accept (buy):** the buyer sends the payment tokens to the seller, and the program
   releases the escrowed tokens to the buyer with a **PDA-signed CPI**
   (`CpiContext::new_with_signer`, seeds `["escrow", authority, bump]`). Both legs
   execute atomically in one transaction.
3. **Cancel:** only the seller (`constraint = escrow.authority == seller.key()`)
   can cancel; the program PDA-signs the tokens back to the seller and closes the
   escrowed token account and the escrow account (`close = seller`, returning rent).

The modern canonical example in the Solana Foundation's program-examples repo uses the
same shape with `make_offer` / `take_offer` / refund instructions:

- `tokens/escrow/anchor` in `solana-developers/program-examples` (see the test-fix PR
  describing its layout): https://github.com/solana-developers/program-examples/pull/502
- DeepWiki summary of the same example (file map):
  https://deepwiki.com/solana-developers/program-examples/3.1-anchor-framework
- Guide converging the three canonical implementations
  (`solana-foundation/anchor/tests/escrow`,
  `solana-foundation/solana-bootcamp-2026/04-escrow`,
  `solana-developers/program-examples/tokens/escrow/anchor`) on Anchor 1.0.0:
  https://docs.chainstack.com/docs/solana-escrow-pattern

Anchor's account-constraint system (`has_one`, `close`, `seeds`/`bump`, `mut`) is what
enforces the safety properties; see the Anchor reference:
https://v2.anchor-lang.com/docs/v1/reference/

### 4.2 Adapting it to a fixed-price NFT-for-SOL marketplace

The examples swap token-for-token. A fixed-price NFT marketplace differs in exactly one
leg (author's design judgment, applying the documented pattern):

| Step | Token-for-token example | Fixed-price NFT marketplace |
|------|------------------------|-----------------------------|
| List | Seller's tokens → PDA-owned vault token account | NFT (amount 1) → PDA-owned vault ATA; listing PDA stores seller, mint, price (lamports), bump |
| Buy | Buyer sends payment tokens to seller; vault releases tokens to buyer | Buyer sends **SOL** (System Program transfer) — price minus fee to seller, fee to fee recipient; vault PDA-signs the NFT (amount 1) to the buyer's ATA; listing + vault closed, rent returned |
| Cancel | Seller-only; tokens return; accounts closed | Same, with the NFT returning to the seller's ATA |

Points that must be enforced in the program (standard Anchor constraints, per the
references above):

- The vault token account's mint must equal the listing's mint, and the vault must hold
  exactly 1 token (NFT invariant: supply 1, decimals 0 — see §3.2).
- The buy instruction must verify the buyer paid the listed price (lamport transfer
  amounts are checked against the listing account, not trusted from client input).
- Cancel must be seller-only (`has_one = seller` or an equivalent constraint) and must
  close the listing and vault accounts so rent is reclaimed.
- Fee handling is a program choice, not part of the canonical pattern: split the SOL
  payment inside the buy instruction (e.g. `price - fee` → seller, `fee` → fee
  recipient). Keep the fee recipient as a fixed address in the listing or program
  config, not a client-supplied account.

### 4.3 What is outdated in the cited Anchor example

The `examples.anchor-lang.com` non-custodial escrow page is old and should be used for
the **pattern**, not copied verbatim:

- Its test file imports `@project-serum/anchor` (the pre-`@coral-xyz/anchor` package
  name) and uses the long-removed `splToken.Token.createMint` API.
- It misspells the instruction `cancle`, and its test calls a method named `execute`
  that does not match the program's `accept` handler.
- It uses `rent: Sysvar<'info, Rent>` explicitly, which modern Anchor handles
  automatically.

Use the `solana-developers/program-examples` `tokens/escrow/anchor` example (actively
maintained; tests fixed in 2026 per PR #502 above) as the code-level model, and the
Anchor examples page as the conceptual description.

---

## 5. Solana devnet

### 5.1 Clusters and public RPC endpoints

- **Devnet:** `https://api.devnet.solana.com` — "Public testing and development",
  "Free SOL airdrop for testing". Devnet tokens are **not real**; devnet "may be
  subject to ledger resets"; "Application developers should target Devnet."
- **Mainnet:** current docs list `https://api.mainnet.solana.com`
  (`https://api.mainnet-beta.solana.com` is the long-standing equivalent widely used
  in code and guides).
- **Testnet:** `https://api.testnet.solana.com` — validator/stress testing.
- Public devnet rate limits per IP: 100 requests / 10 s total, 40 / 10 s for a single
  RPC method, 40 concurrent connections, 100 MB / 30 s. Public endpoints "are not
  intended for production applications."
- https://solana.com/docs/references/clusters
- RPC overview (same endpoints, plus the note that shared endpoints may return 429/403):
  https://solana.com/docs/rpc

For a hackathon demo the public devnet endpoint is sufficient; for anything with real
users, use a dedicated RPC provider (the clusters doc says the same).

### 5.2 Getting devnet SOL — ⚠️ the CLI airdrop may be closed (Nov 2026)

Official faucet: **https://faucet.solana.com** — max **2 requests every 8 hours**, up
to **5 SOL per request** (higher with GitHub sign-in).

- Limits as checked 18 Nov 2026: https://onchainwiki.com/solana-devnet-faucet
- Corroborated: https://www.datawallet.com/crypto/how-to-get-solana-faucet-tokens

CLI airdrop (documented behavior): `solana airdrop 2` — max 2 SOL per request, rate
limited:

- https://github.com/metaplex-foundation/developer-hub/blob/HEAD/src/pages/en/solana/airdrop-sol-for-development.md

**But:** as of 11 Nov 2026 the public RPC faucet behind `requestAirdrop` appears to be
**closed** — direct RPC calls return HTTP 410 with the message "The RPC faucet is
closed on this cluster. Request test SOL at https://faucet.solana.com", and
`solana airdrop` fails with a misleading rate-limit error. Reported with direct RPC
evidence at:

- https://solstackxyz.medium.com/solana-airdrop-2-stopped-working-heres-how-to-get-devnet-sol-in-2026-14ce14c60e38
  (secondary source — a Medium post — but it quotes the RPC response verbatim; re-verify
  with one `requestAirdrop` call before depending on either behavior.)

Practical consequences:

- **Primary path for humans:** the web faucet at https://faucet.solana.com.
- **For scripts/tests:** run `solana-test-validator` locally — its faucet is unlimited
  because the SOL is minted by your own node (same Medium post; also the Metaplex
  developer-hub guide above).
- **Backups:** QuickNode faucet (https://faucet.quicknode.com/solana/devnet),
  Helius faucet, community faucets — listed in the guides above.
- Devnet SOL has no value and cannot be transferred to mainnet
  (https://solana.com/docs/references/clusters).

### 5.3 Verifying a deployed program

- `solana program show <PROGRAM_ID>` — shows program metadata (owner/loader,
  ProgramData address, upgrade authority, last deployed slot, data length, balance).
  `solana program show --programs` lists programs the CLI wallet controls;
  `solana program show --buffers` lists open buffer accounts (deploy uses buffer
  accounts because of the 1,232-byte transaction limit).
  - https://github.com/solana-foundation/developer-content/blob/HEAD/docs/programs/deploying.md
    (Solana Foundation developer docs source)
- Explorer: `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet`
  (the clusters doc lists explorer.solana.com as supporting cluster selection;
  the `?cluster=devnet` pattern is used throughout Metaplex docs, e.g.
  https://www.metaplex.com/docs/smart-contracts/core/guides/javascript/how-to-create-a-core-collection-with-javascript).
- **Explorer presence is not source verification.** To prove the on-chain binary
  matches source, use a verifiable-build workflow (`solana-verify`) or dump the
  program (`solana program dump <ID> out.so`) and compare its SHA-256 with the local
  build artifact:
  https://solana.codeguides.io/solana-cli/deploying-programs/ (secondary guide)

---

## 6. Wallet connection in a plain static HTML/JS site (no build step)

### 6.1 The 2026 recommended path: Wallet Standard

The current recommended approach is the **Wallet Standard**: wallets register
themselves in the page, the dApp discovers them with `getWallets()` from
`@wallet-standard/app`, connects with the `standard:connect` feature, and signs with
the `solana:signTransaction` feature. Phantom's own current developer docs teach
exactly this flow (with `@solana/kit` for transaction building):

- Phantom docs, "Send a Solana v1 transaction" (updated 9 Nov 2026) — finds the
  Phantom wallet via `getWallets()`, checks for `StandardConnect` and
  `SolanaSignTransaction` features, connects, signs:
  https://docs.phantom.com/recipes/transactions/send-solana-v1-transaction
- Wallet Standard repository (now under the Anza org, `anza-xyz/wallet-standard`;
  formerly `solana-labs/wallet-standard`):
  https://github.com/anza-xyz/wallet-standard/blob/HEAD/WALLET.md
- The Solana wallet-adapter packages (`@solana/wallet-adapter-*`) are built on top of
  Wallet Standard and are React-oriented (`WalletMultiButton`, providers, hooks) —
  the right choice for a React app, the wrong shape for a no-build static page. The
  wallet-standard packages themselves (`@solana/wallet-standard-features`,
  `@wallet-standard/app`) are framework-free.

Notes:

- Phantom's docs also offer `@phantom/browser-sdk` (`BrowserSDK`) for injected +
  embedded wallets with `sdk.solana.signAndSendTransaction()` — a Phantom-specific
  SDK, not a multi-wallet solution. For a page that should accept Phantom **and**
  Solflare/Backpack, Wallet Standard is the neutral path.
- Phantom's docs note Ledger does not currently support signing Solana **v1**
  transactions — stick to legacy or v0 transactions for maximum wallet compatibility
  (https://docs.phantom.com/recipes/transactions/send-solana-v1-transaction).

### 6.2 The no-build static-page reality

Wallet Standard and `@solana/kit` are npm ESM packages. In a page with no build step
there are two honest options (author's judgment, grounded in the sources below):

**Option A — ESM via CDN (recommended for new work).** Load `@wallet-standard/app`,
`@solana/wallet-standard-features`, and `@solana/kit` as ES modules from an ESM CDN
(esm.sh or jsDelivr ESM) with an import map, following the Phantom docs flow. This is
the modern path; it requires care with pinned versions and import-map wiring, and it
should be tested against real Phantom/Solflare extensions, not assumed to work.

**Option B — web3.js v1 IIFE bundle + injected provider (legacy, simplest).** The
`@solana/web3.js` v1 package ships an official browser bundle that exposes a
`solanaWeb3` global:

```html
<script src="https://cdn.jsdelivr.net/npm/@solana/web3.js@1/lib/index.iife.min.js"></script>
```

- The web3.js README documents the browser bundle (`lib/index.iife.js` /
  `lib/index.iife.min.js`, global `solanaWeb3`):
  https://cdn.jsdelivr.net/npm/wraptoken-swap@1.1.0/swap/node_modules/@solana/web3.js/README.md
- The injected-provider signing shape (`window.phantom?.solana`, `.connect()`,
  `.signTransaction(tx)`, `.signAndSendTransaction(tx)`) is documented at:
  https://docs.crank.ing/guides/signer-cookbook/
  (secondary cookbook; the provider API itself is Phantom's)

**Security warning — pin versions and use Subresource Integrity (SRI).** Versions
1.95.6 and 1.95.7 of `@solana/web3.js` were compromised (December 2024). Never load
`@latest` for a script that builds transactions a wallet will sign; pin an exact
version, verify its hash, and consider a fallback CDN:

- https://github.com/solana-thailand/bethere/commit/7183333529fc842e6ac74857dd12afdae9e964b4
  (documents the compromised versions and the pin + SRI practice)

Option B is what the sibling Spooky B-Agents-style static sites already do, and it is
fine for a hackathon demo — but it is the legacy path: `window.solana` injection is
being superseded by Wallet Standard registration, and future wallet versions may drop
the injected provider. Option A is the forward-compatible choice; Option B is the
fastest choice. Either way, **never** ask users for seed phrases or private keys — the
wallet signs; the page only builds unsigned transactions.

---

## 7. Recommended approach

### Verdict

**The proposed architecture — memo-based SPL-20-style inscription JSON + Metaplex NFT
carrier + one small Anchor escrow program — is sound, minimal, and honest, provided the
project labels itself accurately.** It uses only standard programs (System, SPL Token,
Memo, Metaplex Token Metadata) plus one custom Anchor program, which is exactly the
right shape for a hackathon demo and a defensible shape for a real product.

### What is sound

1. **Memo inscription (the core idea).** A ~50-byte SPL-20-style JSON record fits
   easily in a 566-byte memo inside a 1,232-byte transaction, costs essentially nothing
   beyond the base fee, is permanently recorded on-chain, and is verifiable by anyone
   from the transaction signature. For a demo whose point is "the inscription is
   on-chain and checkable," this is the cheapest correct mechanism (§2).
2. **Metaplex NFT as carrier.** `createNft` via the Umi SDK is the documented path;
   the resulting mint + metadata + master edition is readable by every wallet,
   explorer, and marketplace (§3). Total rent ≈ 0.015–0.021 SOL depending on the live
   SIMD-0437 rate — trivial on devnet, cheap on mainnet.
3. **One Anchor escrow program.** The make/take/refund pattern is the canonical,
   well-understood Anchor pattern; adapting the payment leg from tokens to SOL is a
   small, standard change. Listing, buying, and cancelling are each one instruction,
   atomic, with rent reclaimed on close (§4).
4. **Devnet-first demo.** Free test SOL, public RPC, explorer verification — all
   documented and sufficient (§5).

### What must be said honestly (do not overclaim)

1. **This is "SPL-20-style", not LibrePlex SPL-20.** Real LibrePlex inscriptions store
   the JSON in inscription accounts owned by the LibrePlex program
   (`inscokhJarcjaEs59QbQ7hYjrKz25LEPRfCbP8EmdUp`); a memo stores it in transaction
   logs. No existing SPL-20 indexer or marketplace will recognize memo inscriptions,
   and SPL-20 has no formal spec or on-chain ledger in either design — balances are
   always indexer-defined (§1). The project docs should say: "inscription JSON in the
   memo of the mint transaction, in the SPL-20 `p/op/tick/amt` shape; verifiable via
   the transaction signature."
2. **The memo does not bind itself to the NFT.** The binding is a stated convention
   (memo in the same transaction as the mint, and/or the mint address inside the JSON),
   not something the chain enforces (§2.4). Document the convention; a verifier
   (human or script) checks it by reading the transaction.
3. **Memo data is not readable by on-chain programs.** If a future feature needs the
   escrow program (or any program) to *check* inscription content, the memo design
   cannot do it — that would require account-state inscriptions (LibrePlex or
   Metaplex `mpl-inscription`). For mint + marketplace as specified, nothing on-chain
   needs to read the JSON, so this is not a blocker.
4. **Token Metadata is legacy.** Metaplex recommends Core for new projects (§3.1).
   Token Metadata remains the compatibility-maximizing choice and is fine for this
   project, but the decision should be recorded as deliberate (compatibility over
   novelty/cost), not made by accident. If the team later wants lower mint cost and a
   forward-looking standard, Core is the documented migration path.

### What does NOT work or is outdated — flags for the build

- **CLI airdrop may be closed.** `solana airdrop` against the public devnet RPC
  reportedly returns HTTP 410 ("RPC faucet is closed") as of Nov 2026. Plan the demo
  around the web faucet (https://faucet.solana.com) and/or a local validator; verify
  once before demo day (§5.2).
- **Rent figures move.** SIMD-0437 is cutting rent up to 90% in steps through late
  2026; any hard-coded "mint costs 0.02 SOL" claim will go stale. Query
  `getMinimumBalanceForRentExemption` at runtime (§3.4).
- **The Anchor examples escrow page is outdated** (`@project-serum/anchor`,
  `cancle` typo, mismatched test). Use `solana-developers/program-examples`
  `tokens/escrow/anchor` as the code model (§4.3).
- **Never load `@solana/web3.js@latest` from a CDN.** Versions 1.95.6/1.95.7 were
  compromised; pin an exact version with an SRI hash (§6.2).
- **LibrePlex is not a maintained reference in 2026.** Its crate is Anchor-0.30-era,
  its docs don't cover SPL-20, and the deployed program is upgradeable by its
  authority. Do not build a dependency on the LibrePlex program without a deliberate
  decision and a fresh audit of its current state (§1.4).
- **Devnet resets.** Demo state (programs, listings, mints) can disappear without
  notice; keep a redeploy script and re-seed instructions (§5.1).
- **v1 transactions and Ledger.** Phantom docs note Ledger cannot sign Solana v1
  transactions; build legacy/v0 transactions for the demo (§6.1).

### Suggested minimal build order (derived from the findings above)

1. Static mint page: Wallet Standard (or web3.js IIFE + injected provider) → build
   one transaction that mints the NFT (`createNft` semantics) with the SPL-20 JSON as
   a memo instruction in the same transaction → show the explorer link and the memo
   read back from the transaction logs.
2. Anchor escrow program (`list` / `buy` / `cancel`) on devnet, following the
   `program-examples` escrow layout with a SOL payment leg and a small fee split.
3. Static marketplace page: read listings from the escrow program accounts, buy/cancel
   through the same wallet connection; verify each listing's NFT by its mint and
   metadata PDA.
4. A short verifier note in the docs: given a mint address, how to find its inscription
   (transaction signature → memo in logs) and how to confirm the listing escrow holds
   the NFT (vault ATA balance = 1).

---

## Source index (primary sources first)

- LibrePlex program source (docs.rs): https://docs.rs/libreplex_inscriptions/latest/src/libreplex_inscriptions/lib.rs.html
- LibrePlex repo: https://github.com/LibrePlex/libreplex-program-library
- LibrePlex docs: https://libreplex.github.io/libreplex-program-library/
- Solana Memo program docs: https://www.solana-program.com/docs/memo
- Solana payments with memo: https://solana.com/docs/payments/send-payments/payment-with-memo
- spl-memo source: https://docs.rs/crate/spl-memo/3.0.1/source/src/processor.rs
- Solana transaction pipeline (1,232-byte limit): https://solana.com/docs/core/transactions/transaction-pipeline
- Metaplex Token Metadata Umi SDK: https://www.metaplex.com/docs/smart-contracts/token-metadata/getting-started/umi
- Metaplex Core guide: https://www.metaplex.com/docs/smart-contracts/core/guides/javascript/how-to-create-a-core-collection-with-javascript
- Metaplex Inscriptions JS SDK: https://www.metaplex.com/docs/smart-contracts/inscription/getting-started/js
- Anchor non-custodial escrow example: https://examples.anchor-lang.com/docs/non-custodial-escrow
- Anchor reference: https://v2.anchor-lang.com/docs/v1/reference/
- Solana program-examples escrow (PR describing the maintained example): https://github.com/solana-developers/program-examples/pull/502
- Solana clusters / RPC endpoints: https://solana.com/docs/references/clusters
- Solana RPC overview: https://solana.com/docs/rpc
- Solana Foundation deploying docs: https://github.com/solana-foundation/developer-content/blob/HEAD/docs/programs/deploying.md
- Phantom developer docs (Wallet Standard flow): https://docs.phantom.com/recipes/transactions/send-solana-v1-transaction
- Wallet Standard repo: https://github.com/anza-xyz/wallet-standard/blob/HEAD/WALLET.md
- Solana rent docs (returned HTTP 429 on 19 Nov 2026; formula corroborated via secondary sources quoting it): https://solana.com/docs/core/rent
