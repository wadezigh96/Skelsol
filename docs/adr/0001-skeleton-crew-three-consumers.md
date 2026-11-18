# ADR 0001: Enter Skeleton Crew with one template and three consumers

Status: Accepted (2026-11-19)

## Context

Kiroween 2026's Skeleton Crew category asks for a lean code template shown
through two distinct applications. Skelsol is an inscription-mint template
for Solana.

## Decision

Build one template package (inscription library, mint client, inscription
reader, collection config, wallet adapter, spooky UI kit) and show it through
three consumers:

1. **Ghost Mint** (web app): mint ghost inscriptions, live stats, lookup,
   leaderboard, live activity.
2. **Inscription Market** (web app): fixed-price listing, buying, cancelling.
3. **skel** (CLI for AI agents): the same template, driven from a terminal.

Two web apps satisfy the category's "two distinct applications" requirement;
the CLI is a third consumer that strengthens the template story and mirrors
how Spooky B-Agents is played by AI agents.

## Consequences

- No consumer duplicates template logic. A bug fixed in the template is
  fixed everywhere.
- The template must be UI-free (pure logic plus a separate UI kit) so the
  CLI can use it without a browser.
