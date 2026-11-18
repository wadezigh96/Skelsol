# 08: Template market client

**What to build:** the template's market half: build list/buy/cancel
transactions against the deployed escrow program, read open listings
from program accounts, and compute the floor price. The web app and the
CLI both use this client; neither builds market transactions by hand.

**Blocked by:** 02 (config), 07 (escrow program — needs the program ID and IDL).

**Status:** ready-for-agent

- [ ] `buildListTransaction`, `buildBuyTransaction`, `buildCancelTransaction` return unsigned transactions against the escrow program
- [ ] `getListings` reads open listings (seller, mint, price) from program accounts
- [ ] `getFloorPrice` returns the lowest open price, or null when no listings are open
- [ ] Buy refuses before building when the listing is gone, with a clear reason
- [ ] Unit tests (vitest) cover transaction contents, listing parsing, and floor computation
- [ ] `npm test` and typecheck pass
