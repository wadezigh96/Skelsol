# 02: Template config — collections and networks

**What to build:** one config per collection and one config per network,
validated at load. A developer launches a new inscription series by
writing one collection config; the apps and CLI pick devnet by default
and mainnet by switch, with the right RPC endpoint and program IDs for
each.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Collection config type: tick, name, supply, per-wallet limit, price (lamports), image, metadata base URI
- [ ] Network config: devnet and mainnet RPC endpoints, Memo v3 program ID, Token Metadata program ID, escrow program ID per network (devnet real after ticket 07; mainnet placeholder until the owner deploys)
- [ ] Ghost collection config shipped: tick GHOST, supply 4444, 4 per wallet
- [ ] Invalid configs (missing tick, non-positive supply, bad URL) are rejected at load with a clear error
- [ ] Unit tests (vitest) cover valid load and every rejection reason
- [ ] `npm test` and typecheck pass
