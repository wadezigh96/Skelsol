# agent.md: the AI-agent manual for Skelsol

This manual tells an AI agent how to use Skelsol from a terminal with
the `skel` CLI. Read it before running any `skel` command. If you are a
human, the same rules apply to you: preview first, confirm explicitly,
never batch-approve.

## 1. What Skelsol is

Skelsol is a lean template for minting SPL-20-style inscriptions on
Solana, shown through two web apps and this CLI. One mint writes an
inscription (a JSON record in a transaction memo) and mints a carrier
NFT that carries it. The demo collection is **GHOST** ("Spooky Ghosts"):

| | |
|---|---|
| Tick | `GHOST` |
| Supply | 4,444 inscriptions |
| Per-wallet limit | 4 inscriptions |
| Mint price | Free (0 lamports); you pay only rent deposits |
| Network default | Devnet (free test SOL from the faucet) |

The two web apps are Ghost Mint (mint + stats + lookup) and the
Inscription Market (list, buy, cancel). The CLI is the third consumer
of the same template library: everything it does, the apps do the same
way. See `GLOSSARY.md` for the shared vocabulary (`skel`, `keypair`,
`preview`, `agent.md`) and `docs/adr/0007-skel-cli-for-ai-agents.md`
for the CLI's design decisions.

## 2. What is live right now (read this first)

Be honest about the current status; do not claim more than this:

- **Mint works on devnet.** Minting needs no custom program (it uses
  the Memo program and Metaplex Token Metadata), so `skel mint` works
  today on devnet. The first live mint was proven 20 Nov 2026 (see
  `docs/SUBMISSION.md`): Minted 1 of 4,444.
- **The market program is deployed on devnet** (19 Nov 2026).
  The escrow program (`skelsol-market`) is live at program ID
  `3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo`
  ([explorer](https://explorer.solana.com/address/3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo?cluster=devnet)).
  `skel status` reports the floor price (0.1 SOL at the 20 Nov 2026
  live check) and `marketStatus` `live`; `skel list`, `skel buy`, and
  `skel cancel` work on devnet.
- **Mainnet:** the market program is not deployed on mainnet, and
  mainnet is real money. Market commands refuse on mainnet with a
  clear message. Default to devnet.
- **Public RPC rate limits:** the devnet reader scans recent Memo
  transactions through the public RPC, which rate-limits heavy reads
  (HTTP 429). If a read fails with "Could not reach the network, try
  again", wait a little and retry; nothing was sent and nothing was
  lost.

## 3. Setup

```sh
# From the repo root: install dependencies, then build the CLI.
npm install
cd cli && npm run build
node dist/cli.js --help
```

To put `skel` itself on your PATH instead of calling `node dist/cli.js`:

```sh
cd cli && npm link
skel --help
```

### The agent wallet

Writes need a local keypair file (the agent wallet). Make one with the
Solana CLI:

```sh
solana-keygen new --outfile ./agent-keypair.json
```

Then fund it with free devnet SOL from the web faucet:
https://faucet.solana.com (paste the wallet address; up to 5 SOL per
request). A mint costs only rent (a fraction of a SOL); a few SOL is
plenty.

**Keypair safety (mandatory):**

- Never commit a keypair file to a repo. The repo's `.gitignore`
  already excludes `*-keypair.json`, `keypair.json`, and `id.json`,
  but check before you commit anyway.
- Never use a keypair holding large funds. Use a dedicated low-value
  agent wallet, funded with only what the agent needs.
- Never paste a secret key into a chat, a ticket, or a log. `skel`
  reads the keypair file only when you pass `--keypair <path>`.

## 4. Commands

Every command accepts `--network devnet|mainnet` (default: devnet)
and `--json` (machine-readable output; see section 6). Write commands
also need `--keypair <path>`. Run `skel help <command>` for usage.

### `skel status` (read-only, no keypair)

Collection state: minted, remaining, minters, and the floor price.
"Minters" counts the wallets that minted an inscription: the reader
never observes transfers, so it cannot say who holds one now. (The
`--json` output still names the field `holders`, for machine
consumers; the number in it is the minter count.)

```sh
skel status
skel status --network mainnet
skel status --json
```

### `skel lookup <wallet>` (read-only, no keypair)

List one wallet's GHOST inscriptions, newest first.

```sh
skel lookup 7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7
skel lookup <wallet> --json
```

### `skel mint` (write)

Mint one GHOST inscription plus its carrier NFT to the keypair wallet.

```sh
skel mint --keypair ./agent-keypair.json
skel mint --keypair ./agent-keypair.json --json
```

The CLI checks supply and your per-wallet limit before building, then
shows a preview with the exact cost and asks you to confirm.

### `skel list <mint> <price-lamports>` (write)

List a carrier NFT for sale at a fixed price. `<mint>` is the carrier
NFT's mint address; `<price-lamports>` is the price in lamports as a
whole number (1 SOL = 1,000,000,000 lamports). The NFT moves into
escrow until it is bought or the listing is cancelled.

```sh
skel list <mint> 1000000000 --keypair ./agent-keypair.json
```

Refuses on mainnet, where the market program is not deployed (see section 2).

### `skel buy <seller> <mint>` (write)

Buy a listed inscription. `<seller>` is the seller's wallet address;
`<mint>` is the carrier NFT's mint address. The listing is re-read
before buying, so a listing that is already gone is refused. The price
charged is always the price stored in the listing, never client input:
99% goes to the seller, 1% to the treasury.

```sh
skel buy <seller> <mint> --keypair ./agent-keypair.json
```

Refuses on mainnet, where the market program is not deployed (see section 2).

### `skel cancel <mint>` (write)

Cancel your listing for a carrier NFT. Only the seller can cancel. The
NFT returns to your wallet and the listing closes.

```sh
skel cancel <mint> --keypair ./agent-keypair.json
```

Refuses on mainnet, where the market program is not deployed (see section 2).

## 5. Safety rules (the preview-before-send rule)

These rules are enforced by the CLI and documented here so an agent
can explain them to its user. They are not optional.

1. **Every write shows a preview first.** Before anything is sent,
   `skel` prints a preview to stderr: what the transaction does, the
   exact cost (rent, price, total), and the inscription or listing
   details. Read it. Show it to the user.
2. **Send only after the user explicitly confirms that exact action.**
   After the preview, `skel` asks for confirmation on stdin and sends
   only on an explicit `yes` (or `y`, case-insensitive). Anything else
   (`no`, `yeah`, `ok`, silence, Enter alone) aborts, and nothing is
   sent.
3. **There is no `--yes` flag.** Do not add one, do not pipe `yes`
   into the CLI to skip the prompt, and do not batch-approve. One
   preview, one confirmation, one transaction.
4. **Confirm the exact action, not the idea of it.** If the preview
   differs from what the user asked for (different mint, different
   price, different cost), abort and ask the user; never confirm a
   preview you did not expect.
5. **Mainnet is real money.** On mainnet every rule above matters
   more: re-read the preview, double-check the price, and confirm the
   user meant mainnet, not devnet.
6. **A refused command is a result, not an error to work around.**
   Supply exhausted, per-wallet limit reached, listing gone, program
   not deployed: these refusals carry a plain-words reason. Report
   the reason; do not retry the same command hoping for a different
   answer, and never fake a success.

## 6. Output format

- **Previews and confirmation prompts always go to stderr.** Stdout
  carries only the final result.
- **With `--json`, stdout is one JSON object and nothing else**, so it
  parses cleanly. The preview still goes to stderr. Example:

```json
{"command":"status","network":"devnet","tick":"GHOST","supply":4444,"minted":1,"remaining":4443,"holders":1,"floorPriceLamports":"100000000","floorPrice":"0.1 SOL","marketStatus":"live","marketMessage":null}
```

(The numbers above are the live state at the 20 Nov 2026 check: one
mint, one listing at 0.1 SOL. On mainnet the market fields read
`"marketStatus":"not-deployed"` with a plain-words
`marketMessage`, because the program is not deployed there.)

- **Prices are strings in JSON** (`"priceLamports": "1000000000"`)
  because lamport amounts can exceed what a JSON number holds exactly.
  A formatted `price` field (`"1 SOL"`) sits next to each lamport
  field.
- **Errors go to stderr** as one line (`Error: <message>`) with exit
  code 1, and stdout stays empty. A user declining to confirm also
  exits 1, with `Aborted: the transaction was not sent.` on stderr.

## 7. Networks

- **Devnet is the default.** Every command runs on devnet unless you
  pass `--network mainnet`. Devnet SOL is free from the faucet:
  https://faucet.solana.com
- **Mainnet is real SOL.** Pass `--network mainnet` only when the user
  explicitly asks for mainnet. The market program is not deployed on
  mainnet, so market commands refuse there.
- RPC endpoints: devnet `https://api.devnet.solana.com`, mainnet
  `https://api.mainnet.solana.com`.
- Explorer links in `skel` output point at https://explorer.solana.com
  with `?cluster=devnet` on devnet links.

## 8. On-chain addresses

| | |
|---|---|
| Escrow (market) program ID (devnet) | `3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo` |
| Escrow program explorer | https://explorer.solana.com/address/3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo?cluster=devnet |
| Treasury (1% fee recipient; placeholder, the devnet deployer's wallet) | `7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7` |
| Memo program (same on every network) | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Metaplex Token Metadata (same on every network) | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |

The market program ID is final (its keypair is stable) and the
program is deployed on devnet (19 Nov 2026): the explorer link shows
the live program. See `docs/DEPLOY.md` for the deploy status, the
re-deploy funding notes, and how to verify a deploy.

## 9. Worked examples

### Check the collection, then look up a wallet

```sh
$ skel status
GHOST (Spooky Ghosts) on devnet
Minted: 1 of 4444 (4443 remaining)
Minters: 1
Floor price: 0.1 SOL

$ skel lookup <wallet>
Wallet <wallet>: 1 GHOST inscription
```

(The numbers above are the live state at the 20 Nov 2026 check.)

### Mint one inscription

```sh
$ skel mint --keypair ./agent-keypair.json
Preview: mint one GHOST inscription + carrier NFT.
  Wallet: <your wallet>
  Inscription: {"p":"spl-20","op":"mint","tick":"GHOST","amt":"1","mint":"<new mint>"}
  Carrier NFT mint: <new mint>
  Rent deposits: 0.002 SOL (2000000 lamports)
  Mint price: 0 SOL (0 lamports)
  Network fee (estimate): 0.00001 SOL (10000 lamports)
  Total: 0.00201 SOL (2010000 lamports)
  Rent deposits are refundable: they come back when the accounts close.
  Nothing is sent until you confirm.
Send this mint transaction? Type yes to confirm: yes
Minted! Your ghost inscription is on-chain.
Carrier NFT mint: <new mint>
Signature: <signature>
Explorer: https://explorer.solana.com/tx/<signature>?cluster=devnet
```

(The rent figures above are illustrative; the real preview shows the
live rent query for your mint.)

### List, then cancel

```sh
$ skel list <mint> 1000000000 --keypair ./agent-keypair.json
Preview: list one carrier NFT for sale.
  Seller: <your wallet>
  Carrier NFT mint: <mint>
  Listing: <listing address>
  Price: 1 SOL (1000000000 lamports)
  Fee on sale: 1% to the treasury; you receive 99%.
  The NFT moves into escrow until it is bought or the listing is cancelled.
  Nothing is sent until you confirm.
Send this list transaction? Type yes to confirm: yes
Listed! Your carrier NFT is in escrow.
Listing: <listing address>
Signature: <signature>
Explorer: https://explorer.solana.com/tx/<signature>?cluster=devnet

$ skel cancel <mint> --keypair ./agent-keypair.json
Preview: cancel your listing.
  Seller: <your wallet>
  Carrier NFT mint: <mint>
  Listing: <listing address>
  Listed price: 1 SOL (1000000000 lamports)
  The NFT returns to your wallet and the listing closes.
  Nothing is sent until you confirm.
Send this cancel transaction? Type yes to confirm: yes
Cancelled! The carrier NFT is back in your wallet.
```

(These two commands refuse on mainnet with "the market program is
not deployed on mainnet yet", because the program is deployed on
devnet only; see section 2.)

### Buy a listing

```sh
$ skel buy <seller> <mint> --keypair ./agent-keypair.json
Preview: buy one listed inscription.
  Buyer: <your wallet>
  Seller: <seller>
  Carrier NFT mint: <mint>
  Listing: <listing address>
  Price: 1 SOL (1000000000 lamports)
  Seller receives: 0.99 SOL (990000000 lamports)
  Treasury fee (1%): 0.01 SOL (10000000 lamports)
  Nothing is sent until you confirm.
Send this buy transaction? Type yes to confirm: yes
Bought! The carrier NFT is in your wallet.
```

### Drive it from another program (JSON mode)

```sh
$ skel status --json
{"command":"status","network":"devnet","tick":"GHOST", ...}

$ skel lookup <wallet> --json
{"command":"lookup","network":"devnet","wallet":"<wallet>","count":1,"inscriptions":[{"mint":"<mint>", ...}]}
```

Stdout parses as JSON with no extra text; the preview (for writes)
stays on stderr. Note that writes still ask for confirmation on stdin
in `--json` mode: pipe the user's `yes` only after showing them the
preview from stderr.
