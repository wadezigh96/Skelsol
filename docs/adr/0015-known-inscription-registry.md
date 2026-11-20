# ADR 0015: Known-inscription registry (mints the live scan can no longer reach)

Status: Accepted (2026-11-20)

## Context

The first live devnet mint (20 Nov 2026) proved the reader's window
is far smaller in practice than the docs implied. The mint
transaction finalized (slot 524412436, signature
`4LS2AsdK...t8H85F`, minter
`AqNex3qwMyxzCi6dRTfvmJ8FdMFzMrGDFPXRmWZG1wtK`, carrier NFT
`CzTUinyVnogVvfgH87AruwwAT6QfVZvbAa4CnXwbTP7x`): the memo
instruction carries the exact GHOST inscription JSON and the
Metaplex Create + Mint instructions succeeded. Yet minutes later
`skel status`, `skel lookup`, and both hosted sites all showed
Minted 0 / Minters 0.

The cause is the reader's scan window. `scanCollection` lists the
20 most recent transactions that touched the Memo program
(`DEFAULT_SCAN_LIMIT`), network-wide, and the memo program is
shared with every other memo on the network. Measured on devnet
that day: the 20 most recent memo transactions spanned 22 slots
(about 9 seconds), roughly 2 memo transactions per second, nearly
all of them unrelated spam. A mint falls out of the window within
about a minute of landing, and every count built on the scan
(minted, minters, leaderboard, activity, mint limits, lookup)
forgets it. The window was documented as a limit (README, "the
reader only sees the most recent 20 memo transactions"), but the
measured traffic rate turns a soft limit into a functional one: a
demo mint is invisible almost immediately.

Two further observations from the same live test, recorded here,
not fixed here:

- The CLI's mint confirmation relies on a websocket subscription.
  From the machine that ran the test, the devnet websocket endpoint
  is unreachable (TLS handshake failure), so the CLI reported
  "Transaction was not confirmed in 30.00 seconds" even though the
  transaction had finalized. The mint was verified out-of-band
  (`solana confirm` + `getTransaction`). A confirmation path that
  polls over HTTPS would report correctly on such networks.
- The mint preview understated the cost: preview 0.00793988 SOL
  against an actual spend of 0.01705088 SOL (the Metaplex metadata
  account rent, 0.0137338 SOL, dominates). The preview's rent
  estimate needs to match what the builder actually creates.

## Decision

The collection config gains an optional `knownInscriptions` list:
mint-transaction signatures the reader always fetches directly, in
addition to the live memo scan. After the live scan,
`scanCollection` fetches each registered signature (same retry,
concurrency, and cache behavior), verifies it through the exact
same path as a scanned transaction (memo parsed from the real
transaction, mint binding checked, holder resolved), and merges it
into the same by-mint map, so a registered mint counts toward
`minted`, `holders`, the leaderboard, activity, mint limits, and
lookup exactly like a fresh one. A registered signature still
inside the live window is fetched once, through the live scan, and
counts as scanned rather than registered.

The state says where its numbers came from: `ScanResult` gains
`registeredInscriptions` and `CollectionState` gains `fromRegistry`
(the verified inscriptions found through the registry that the
live scan did not already find). The CLI prints "Verified from the
collection registry: N" on `skel status` (and reports `fromRegistry`
in `--json`), and both apps show "Includes N verified
inscription(s) from the collection registry." in the stats note.
The GHOST collection registers the first live devnet mint above.

## Consequences

- A mint stays visible however old it gets, at the cost of one
  extra transaction fetch per registered signature on a cold scan
  (cached per session afterwards, like every other fetch).
- The registry is a static index: it must be updated as new mints
  age out of the live window. For the demo that means adding a
  signature to `GHOST_COLLECTION` after a mint; nothing discovers
  mints on its own yet.
- The registry cannot lie about a mint: a registered signature
  whose transaction is pruned is skipped, a malformed one is
  counted as malformed, and one whose binding fails is excluded
  and counted as unverified — the same treatment as a scanned
  transaction.
- The long-term fix is a real indexer: a service that polls the
  memo program continuously and stores found inscriptions, so no
  manual registry is needed. That is a bigger build (service +
  store + site changes) and is documented future work, not part of
  this decision.

## Alternatives considered

- Raising `scanLimit`: the window still slides (a 1,000-transaction
  scan covers about 8 minutes of current devnet memo traffic), and
  a large scan is slow and rate-limited on the public RPC. Rejected.
- Paginating backwards with `before`: the same cost as a large
  scan, now O(all devnet memo traffic) instead of O(recent). The
  cost grows with the network's spam, not with the collection.
  Rejected for page loads.
- A full indexer service now: the correct product answer, but too
  big for the demo's remaining window; the registry delivers the
  same visible result for a collection with a handful of mints.
  Deferred, not rejected.
