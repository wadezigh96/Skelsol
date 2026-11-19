# ADR 0013: Market read retries once, then falls back to the public endpoint

Status: Accepted (2026-11-19)

## Context

After the Helius dedicated RPC was installed (ADR 0012), the live-browser
diagnosis showed a split result: the collection scan mostly worked (only
2-4 of 20 transaction fetches failed per load), but the market read
failed on every observed load (4 of 4), on both sites. Two facts from
the diagnosis explain the split:

- The transaction fetches retry rate-limit-looking failures up to 3
  times (ADR 0011). The market read had no retry at all: one transient
  failure killed it.
- The market read's failure was invisible. `readMarketState` threw a
  plain-words error whose raw RPC error lived only in its `cause`,
  and the Ghost Mint note discarded even that (`catch {}` with a fixed
  string), so no browser check could ever report what actually failed.
  The raw HTTP status from the browser was never obtainable (no
  DevTools on the test setup), so the fix cannot depend on knowing the
  exact error.

A related find: the market read's failing call was `getProgramAccounts`
(the escrow program's listing query), not the deploy check — the market
app showed the generic network message, which only `getListings` throws,
while a deploy-check failure would have surfaced its raw message.
The same call succeeds against the public endpoint (proven by
`skel status` before the Helius install), so the public endpoint is a
working second chance for exactly this read.

## Decision

- `readMarketState` retries a rate-limit-looking failure once on the
  primary connection (2 attempts, 250ms delay), using a shared
  `withRetry` helper in `async.ts`. The retry rule walks the error's
  `cause` chain, because the template wraps raw RPC errors in
  plain-words errors whose own message says nothing about the cause.
  Non-retryable failures still fail after the first try.
- When the primary read still fails, `readMarketState` tries once
  more on a fallback connection (when one is given). The apps pass
  `createPublicMarketConnection(network)`, which points at the
  network's built-in public endpoint via the new
  `getDefaultRpcEndpoint` (it ignores overrides by design). The
  fallback is a single attempt, no retry: the whole read (2 primary
  attempts + 1 fallback) stays inside the apps' 15-second market
  deadline.
- `checkMarketDeployed` now wraps an RPC failure in a `MarketError`
  (`rpc-error`, plain-words message, raw error as `cause`), like
  `getListings` already did. A network failure is not a missing
  program, and the wrapping keeps the retry rule and the error
  display working on the same shape.
- When the market read fails, the apps show the underlying cause
  after the plain message ("Could not reach the market right now.
  (429 Too Many Requests)") via the new `withCause` helper in
  `errors.ts`, truncated to 80 characters. The plain message is
  what a user reads first; the cause is what a diagnostic needs.
  A timeout error has no cause, so it shows no suffix.
- The stale header comment in `market.ts` (and the matching test
  comment) claiming the program was "not yet deployed to devnet"
  is corrected: the program has been deployed since 19 Nov 2026.
  The comment had misled the browser diagnosis into reporting the
  program as undeployed.

## Consequences

- A single transient failure no longer kills the market read, and a
  systematic failure on the configured endpoint still has one
  working second chance. The market note now says what failed
  instead of only that it failed.
- The fallback uses the public endpoint, which rate-limits bursts —
  but the market read is one or two calls, not a 20-fetch burst, so
  it is far less exposed than the scan was. The scan itself keeps
  using only the configured endpoint.
- The retry adds at most ~250ms plus one extra read to a failing
  market load; a healthy load is unchanged (first attempt succeeds).
- `getFloorPrice` benefits from the retry automatically, since it
  reads through `readMarketState`. The CLI does not pass a fallback
  connection, so it retries only.
