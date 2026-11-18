# ADR 0006: UI mirrors Spooky B-Agents

Status: Accepted (2026-11-19)

## Context

The user asked for both apps to look like their earlier project,
Spooky B-Agents (https://spookybaw.vercel.app/): dark Halloween theme,
ghost/pumpkin hero, a stats row, lookup, mint, market table with buy/sell
forms, leaderboard, and live activity.

## Decision

Both web apps reuse one spooky UI kit (same theme, hero, stats row, section
layout) from the template, with different content:

- Ghost Mint: hero, stats row, lookup, mint section, leaderboard, live
  activity.
- Inscription Market: hero, stats row, listings table, buy form, sell form,
  live activity.

The visual style of the kit follows ADR 0009 (Vision style: giant bold
type, numbered sections, vertical edge text, near-black `#0a0a0a` with a
maroon `#7f1d1d` accent, white text, dark throughout).

## Consequences

- The UI kit is shared, so the two apps look like siblings, not two
  different projects.
- The design is inspired by Spooky B-Agents; no Spooky B-Agents code,
  images, or assets are reused. All assets are new.
