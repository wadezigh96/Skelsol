# 06: Spooky UI kit + Ghost Mint app

**What to build:** the shared spooky UI kit (dark Halloween theme, hero,
stats row, lookup, leaderboard, activity sections, mirroring the
Spooky B-Agents layout with all-new assets) in the **Vision visual style**
(ADR 0009): giant bold display type, numbered sections, vertical edge
text, thin divider lines, palette near-black `#0a0a0a` / maroon `#7f1d1d`
accent / white text, dark throughout (no orange, no white sections). And
the first web app built on it: Ghost Mint. A visitor sees live stats,
looks up any wallet, and a connected wallet can mint a ghost inscription
and see its own minted count and remaining allowance.

**Blocked by:** 03 (mint client), 04 (reader), 05 (wallet adapter).

**Status:** ready-for-agent

- [ ] UI kit theme and shared sections render in both apps' style (this ticket ships Ghost Mint; the market app reuses the kit in ticket 09)
- [ ] Vision style applied through the kit: palette CSS variables (`--skel-bg #0a0a0a`, `--skel-accent #7f1d1d`, `--skel-text #ffffff`), giant display-type component, numbered-section component (`01 /MINT` …), vertical edge text
- [ ] Ghost Mint shows hero (dark, dramatic, glowing new art, giant title), stats row (minted, holders, inscriptions, listings, floor), lookup, mint section, leaderboard, live activity
- [ ] Mint flow: connect wallet, see cost, confirm in wallet, see explorer link
- [ ] Network switch visible: devnet default, mainnet toggle, state refreshes on switch
- [ ] Dependencies load through an import map with exact pinned versions (never `@latest`)
- [ ] Page builds with `tsc`, typechecks, and the mint flow is verified against fixtures
- [ ] `npm test` and typecheck pass
