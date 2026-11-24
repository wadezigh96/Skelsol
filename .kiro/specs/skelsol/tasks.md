# Tasks

Implementation plan for Skelsol. Each task maps to a tracer-bullet ticket
in `.scratch/skelsol/issues/`; work the frontier (any task whose blockers
are done). All work is TDD: one red-green slice at a time, at the seams in
`design.md`.

Status (19 November 2026): tickets 01–11 are done, including the
devnet deploy (7.3, deployed 19 Nov 2026; see `docs/DEPLOY.md`).
Both demo apps are hosted on Vercel. Follow-up fix after launch:
the page refresh was too slow on the public RPC (ADR 0011: one scan
per refresh, parallel fetches, fast-fail 429s).

- [x] 1. Template inscription library (ticket 01)
  - [x] 1.1 Build/parse/verify SPL-20-style JSON, with the `mint` binding field
  - [x] 1.2 Reject bad tickers, amounts, and operations with clear errors
  - [x] 1.3 Unit tests: round-trip, malformed input, wrong-ticker detection
- [x] 2. Template config: collections and networks (ticket 02)
  - [x] 2.1 Collection config type and loader with validation
  - [x] 2.2 Network config: devnet/mainnet RPC endpoints and program IDs
  - [x] 2.3 Ghost collection config (GHOST, supply 4444, 4 per wallet)
  - [x] 2.4 Unit tests: valid config loads, invalid config rejected
- [x] 3. Template mint client (ticket 03, blocked by 1, 2)
  - [x] 3.1 Build the mint transaction: memo instruction + NFT mint (Umi `createNft`)
  - [x] 3.2 Limit checks via the reader before building
  - [x] 3.3 Live rent query for the cost breakdown; serialize-check the 1,232-byte cap
  - [x] 3.4 Unit tests: transaction contents, limit refusals, oversize refusal
- [x] 4. Template reader (ticket 04, blocked by 1, 2)
  - [x] 4.1 Fetch transactions and extract memo inscriptions
  - [x] 4.2 Verify the binding convention per inscription
  - [x] 4.3 Aggregate: collection state, leaderboard, activity, wallet lookup
  - [x] 4.4 Unit tests against recorded transaction fixtures
- [x] 5. Template wallet adapter (ticket 05, blocked by 2)
  - [x] 5.1 Wallet Standard discovery, connect, sign
  - [x] 5.2 Devnet/mainnet connection handling
  - [x] 5.3 Unit tests with a mocked wallet
- [x] 6. Spooky UI kit + Ghost Mint app (ticket 06, blocked by 3, 4, 5)
  - [x] 6.1 UI kit: theme CSS, hero, stats row, lookup, leaderboard, activity sections
  - [x] 6.2 Ghost Mint page wired to the mint client and reader
  - [x] 6.3 Network switch (devnet default, mainnet toggle)
  - [x] 6.4 Page loads and typechecks; mint flow verified against fixtures
- [x] 7. Escrow program (ticket 07, blocked by Anchor toolchain approval)
  - [x] 7.1 Anchor program: `list`, `buy`, `cancel` (SOL leg, 1% fee)
  - [x] 7.2 Anchor tests: happy paths, seller-only cancel, wrong-price rejection
  - [x] 7.3 Deploy to devnet; record program ID in `docs/DEPLOY.md` (deployed 19 Nov 2026)
- [x] 8. Template market client (ticket 08, blocked by 2, 7)
  - [x] 8.1 Build list/buy/cancel transactions
  - [x] 8.2 Read open listings from program accounts; floor price
  - [x] 8.3 Unit tests: transaction contents, listing parsing, floor computation
- [x] 9. Inscription Market app (ticket 09, blocked by 6, 8)
  - [x] 9.1 Market page: listings table, buy form, sell form, live activity
  - [x] 9.2 Wire list/buy/cancel through the wallet adapter
  - [x] 9.3 Page loads and typechecks; flows verified against fixtures
- [x] 10. skel CLI + agent.md (ticket 10, blocked by 3, 4, 8)
  - [x] 10.1 Commands: `status`, `mint`, `list`, `buy`, `cancel`, `lookup`
  - [x] 10.2 Flags: `--network`, `--json`, `--keypair`; preview-before-send
  - [x] 10.3 `agent.md` manual at the repo root
  - [x] 10.4 Unit tests: argument parsing, `--json` shape, transaction building
- [x] 11. Docs and submission (ticket 11, blocked by 6, 9, 10)
  - [x] 11.1 README (features, architecture, quickstart, judge path)
  - [x] 11.2 `docs/SUBMISSION.md` (Devpost draft; video + "How Kiro was used" stay honest TODOs)
  - [x] 11.3 `docs/DEPLOY.md` (program ID, redeploy script, devnet faucet notes)
  - [x] 11.4 Final verification: `npm test`, typecheck, both apps build
