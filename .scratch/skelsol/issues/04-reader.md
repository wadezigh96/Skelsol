# 04: Template reader

**What to build:** the component that rebuilds collection state from the
chain: it finds inscription memos in transaction logs, verifies the
binding convention, and aggregates minted count, remaining supply,
holders, leaderboard, activity, and wallet lookup. It works from recorded
transaction fixtures in tests, so the suite stays offline.

**Blocked by:** 01 (inscription library), 02 (config).

**Status:** ready-for-agent

- [ ] `getCollectionState` counts inscriptions from on-chain records (minted, remaining, holders)
- [ ] `getLeaderboard` returns holders ordered by count, most first
- [ ] `getActivity` returns recent mint/transfer/listing/buy events, newest first
- [ ] `lookupWallet` lists a wallet's inscriptions in the collection
- [ ] Malformed memos are skipped and counted, never crash the reader
- [ ] Unit tests (vitest) against checked-in recorded transaction fixtures cover all four functions plus the malformed-memo case
- [ ] `npm test` and typecheck pass
