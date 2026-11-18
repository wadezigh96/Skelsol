# 03: Template mint client

**What to build:** the transaction builder that mints an inscription: one
transaction carrying the memo inscription JSON plus the carrier NFT mint.
Before building, it checks supply and the per-wallet limit through the
reader and refuses with a reason. It reports the exact cost (live rent
query, never a hard-coded figure) and refuses a transaction that would
exceed the 1,232-byte packet cap.

**Blocked by:** 01 (inscription library), 02 (config).

**Status:** ready-for-agent

- [ ] `buildMintTransaction` returns an unsigned transaction (memo + NFT mint via Umi `createNft` semantics) and a cost breakdown
- [ ] Supply exhausted or per-wallet limit reached refuses before building, with a clear reason
- [ ] Cost comes from a live `getMinimumBalanceForRentExemption` query; no hard-coded rent figures anywhere
- [ ] Oversize transactions (over 1,232 bytes serialized) are refused with a clear reason
- [ ] Unit tests (vitest) cover transaction contents, both limit refusals, and the oversize refusal
- [ ] `npm test` and typecheck pass
