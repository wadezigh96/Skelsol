# 04b: Reader hardening — survive public RPC rate limits

**What to build:** the reader (ticket 04) currently dies when any single
transaction fetch fails, and the public devnet RPC rate-limits the
100-fetch scan (HTTP 429), so live `status` / `lookup` / mint-limit
checks fail in the real world. Harden the reader so a scan degrades
gracefully instead of dying: failed fetches are skipped and counted,
rate-limit failures are retried with backoff, and already-scanned
signatures are cached so a refresh only fetches new ones.

**Blocked by:** 04 (reader). Discovered by the ticket 10 agent's live
probe: `getSignaturesForAddress` works, but ~1/3 of the 100 sequential
`getParsedTransaction` calls fail with 429 / "fetch failed".

**Status:** ready-for-agent

- [ ] A failed `getTransaction` fetch is skipped and counted, never fatal to the scan (only a failed `getSignaturesForAddress` fails the whole scan, as `rpc-error`)
- [ ] Rate-limit-looking failures are retried with backoff (a few attempts, growing delays) before a fetch is given up on; delays are injectable so tests stay fast
- [ ] `CollectionState` reports `failedFetches` (and `scanned`) so callers can show "some records could not be read" honestly; existing fields are unchanged
- [ ] An optional caller-held signature cache (`ReaderOptions.cache`) lets refreshes skip already-fetched signatures; a test proves a second scan fetches only new signatures
- [ ] Default scan limit is lowered so a cold scan stays inside public RPC limits; the limit stays overridable via options
- [ ] Existing reader tests still pass, except tests asserting the old fatal-on-fetch-failure behaviour, which are updated deliberately and called out in the report
- [ ] `npm test` and typecheck pass; live `skel status` is attempted once as a smoke check (if it needs an approval the agent cannot get, the unit tests stand as verification and the report says so)
