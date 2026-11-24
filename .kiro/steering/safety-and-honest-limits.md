# Skelsol safety rules and honest-limits documentation

This steering file captures the preview-before-send safety rule and the
honest-limits documentation standard. Source: `agent.md` §5, `README.md`
("Honest limits"), ADR 0002, ADR 0003, `requirements.md` §9.2.

## Preview-before-send (the safety rule)

Every write operation — in both the web apps and the `skel` CLI — must
follow these rules. They are enforced by the CLI and documented in
`agent.md` §5. They are not optional.

1. **Every write shows a preview first.** Before anything is sent,
   `skel` prints a preview to stderr: what the transaction does, the
   exact cost (rent, price, total), and the inscription or listing
   details. Read it. Show it to the user.
2. **Send only after the user explicitly confirms that exact action.**
   After the preview, `skel` asks for confirmation on stdin and sends
   only on an explicit `yes` (or `y`, case-insensitive). Anything else
   (`no`, `yeah`, `ok`, silence, Enter alone) aborts, and nothing is
   sent.
3. **There is no `--yes` flag.** Do not add one, do not pipe `yes` into
   the CLI to skip the prompt, and do not batch-approve. One preview,
   one confirmation, one transaction.
4. **Confirm the exact action, not the idea of it.** If the preview
   differs from what the user asked for (different mint, different
   price, different cost), abort and ask the user; never confirm a
   preview you did not expect.
5. **Mainnet is real money.** On mainnet every rule above matters more:
   re-read the preview, double-check the price, and confirm the user
   meant mainnet, not devnet.
6. **A refused command is a result, not an error to work around.**
   Supply exhausted, per-wallet limit reached, listing gone, program
   not deployed: these refusals carry a plain-words reason. Report the
   reason; do not retry the same command hoping for a different
   answer, and never fake a success.

Output convention: previews and confirmation prompts go to stderr.
Stdout carries only the final result. With `--json`, stdout is one
JSON object and nothing else; the preview still goes to stderr.

## Honest-limits documentation standard

Document limits deliberately, as design facts, not footnotes. These
limits are part of the project. State them plainly wherever the
relevant feature is described.

- **"SPL-20-style", not LibrePlex SPL-20.** No existing SPL-20 indexer
  or marketplace will recognise these inscriptions. There is no
  published SPL-20 specification; the JSON shape is a community
  convention, and balances are always indexer-defined.
- **Memo inscriptions live in transaction logs, not account state.**
  They are permanent in the ledger and verifiable from the transaction
  signature, but no on-chain program can read them. They can only be
  found by scanning transactions. Long-range availability depends on
  archival RPC/explorer retention.
- **The memo↔NFT binding is a documented convention.** The memo and
  the NFT mint are in the same transaction, and the JSON carries the
  mint address in an extra `mint` field. The chain does not enforce
  this binding; the reader verifies it by reading the transaction.
- **Supply caps and per-wallet limits are client-side rules.** They are
  enforced by the reader counting on-chain inscriptions, not by a
  program. There is no custom mint program, so nothing on-chain stops
  a determined actor from minting past the cap.
- **The reader only sees the most recent 20 memo transactions — plus
  the known-inscription registry.** Mints that age out stay visible
  through the collection's `knownInscriptions` registry (ADR 0015). The
  registry is a static index — new mints must be added manually —
  until a real indexer service replaces it.
- **Token Metadata is legacy.** Metaplex recommends Core for new
  projects. Skelsol uses Token Metadata deliberately for compatibility
  (every wallet, explorer, and marketplace reads it). Core is the
  documented migration path.
- **Rent figures are never hard-coded.** SIMD-0437 is cutting rent in
  steps through late 2026, so the mint client queries the live rent
  minimum at runtime.
- **Carrier NFT metadata is per-mint, but the file is shared.** The
  mint client points each carrier at `${metadataBaseUri}<mint>.json`,
  a unique URI per mint, while the repo ships one shared metadata
  file. Serving it for every per-mint URI needs a host rewrite rule.
- **Devnet can reset.** Programs, listings, and mints can disappear
  without notice. `docs/DEPLOY.md` has the redeploy and re-seed steps.
- **The market UI must never pretend to trade when no program is
  deployed.** If the Anchor/Solana toolchain cannot be installed, the
  market ships with the program code and tests but no devnet deploy,
  and the final report says so plainly (ADR 0003).
- **Submission placeholders stay honest TODOs.** The demo video link and
  the "How Kiro was used" section in `docs/SUBMISSION.md` remain honest
  TODO placeholders until the owner provides them (requirement 9.2).
