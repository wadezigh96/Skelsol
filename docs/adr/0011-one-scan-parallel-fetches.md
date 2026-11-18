# ADR 0011: One scan per refresh, parallel fetches, fast-fail 429s

Status: Accepted (2026-11-19)

## Context

After the demo apps went live on Vercel, a real-browser check found
both pages stuck on "Loading on-chain state…" for 80+ seconds with no
error and no numbers. A live probe reproduced the load at about 30
seconds from this VM. The breakdown showed three compounding causes:

- Each page ran three separate reader scans (state, leaderboard,
  activity), and the memo window slides while they run: devnet memo
  traffic is heavy, so each scan's "last 20" was a mostly new set of
  transactions. Three scans fetched 58 transactions, not 20.
- Fetches ran one at a time, about 470ms each against the public RPC.
- A 429 was retried twice: once inside web3.js (up to ~7.5s of
  waiting per call) and once by the reader (3 attempts). Under
  heavier rate limiting, the page simply never finished, and the UI
  had no timeout, so it looked hung instead of slow.

A second, smaller bug rode along: Ghost Mint's "market program is not
deployed yet" note was static HTML, never updated by JavaScript, so
it stayed wrong after the program deployed.

## Decision

- One scan per refresh: `getCollectionOverview` runs a single scan
  and derives state, leaderboard, and activity from it. The
  individual getters stay for callers that need one view (the CLI,
  the mint limit check).
- Fetches run with bounded concurrency (5 at a time, via a
  `fetchConcurrency` option). Fetching is the only parallel part:
  parsing still walks the signatures newest first, so a duplicate
  mint keeps its newest record. A test locks both properties in.
- Connections are built with `disableRetryOnRateLimit: true`, so a
  429 fails fast to the reader's bounded retry and skip-and-count
  instead of burning seconds inside web3.js. The reader's retry
  budget is unchanged; failed fetches are still reported honestly.
- Each page refresh has a deadline (30s for the scan, 15s for the
  market read) via a `withTimeout` helper: a slow network surfaces
  as a plain-words error, never a hang.
- Ghost Mint's market note is live: the refresh reads the market
  state (`readMarketState`) and reports deployed / not deployed /
  unreachable, with live listing and floor numbers when deployed.

## Consequences

- Page load went from ~30s to ~1.7s on the public devnet RPC (live
  probe, 19 Nov 2026); `skel status` went from ~13.6s to ~2.4s.
- Worst case is now bounded: a refresh either shows numbers (possibly
  partial, with an honest warning) or a clear error within 30s.
- The `disableRetryOnRateLimit` change has no unit-test seam: the
  flag lives in web3.js's private connection config, so no test can
  observe it. It is verified by the live probe above, not by the
  suite. If a future web3.js version changes the flag's meaning, the
  probe is the check that catches it.
- The market note on Ghost Mint now names the sibling demo site
  (https://skelsol-market.vercel.app). If the market moves, the
  link in `apps/ghost-mint/public/index.html` moves with it.
