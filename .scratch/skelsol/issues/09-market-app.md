# 09: Inscription Market app

**What to build:** the second web app: a fixed-price marketplace for
inscriptions, reusing the spooky UI kit from ticket 06. A visitor sees
open listings and the floor price; a connected wallet can list a carrier
NFT it owns, buy a listing, or cancel its own listing.

**Blocked by:** 06 (UI kit + Ghost Mint), 08 (market client).

**Status:** ready-for-agent

- [ ] Market page shows hero, stats row, listings table (seller, amount, price, total), buy form, sell form, live activity
- [ ] List flow: pick an owned carrier NFT, set a price, confirm, see the listing appear
- [ ] Buy flow: pick a listing, see the total, confirm, receive the NFT
- [ ] Cancel flow: cancel an own listing, get the NFT back
- [ ] Network switch (devnet default, mainnet toggle) shared with Ghost Mint
- [ ] Page builds with `tsc`, typechecks, and the flows are verified against fixtures
- [ ] `npm test` and typecheck pass
