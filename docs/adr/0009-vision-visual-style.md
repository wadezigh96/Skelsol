# ADR 0009: Vision visual style (Framer Vision Portfolio, dark maroon)

Status: Accepted (2026-11-19). Refines ADR 0006: the page structure still
follows Spooky B-Agents, but the visual style follows the Framer "Vision
Portfolio" template the user chose, recolored dark maroon.

## Context

The user sent a screenshot of the Framer "Vision Portfolio" template and
asked both Skelsol apps to look like it. The template's look: giant bold
typography filling the width, a dramatic dark hero with a glowing image,
numbered sections (`01 /INTRODUCTION`, `02 /FEATURED`), vertical text
along the page edges, and a clean layout with thin divider lines. Its
original accent is orange and its lower sections are white; the user
wants neither. The apps must stay dark throughout.

## Decision

- **Palette** (CSS variables in the UI kit, used by both apps):
  - background: near-black `#0a0a0a`;
  - accent: maroon `#7f1d1d` (deep red; `#800000` is the same family);
  - text: white `#ffffff`;
  - muted text and thin rules: white at low opacity.
  No orange. No white background sections.
- **Typography**: one bold condensed sans-serif for display type. Page
  titles are giant (filling the width, like `VISION PORTFOLIO` in the
  reference). Section headings are large and bold. Body text stays small
  and quiet so the display type dominates.
- **Hero**: dark, dramatic, full-width, with a glowing image (new art,
  made for Skelsol) and the giant title overlaid. A slim top bar carries
  the project name, the network indicator, and the wallet button.
- **Numbered sections**: every section is headed by a number and a label
  (`01 /MINT`, `02 /MARKET`, `03 /LEADERBOARD` …) with a thin rule above
  it, exactly like the reference's `01 /INTRODUCTION`.
- **Vertical text**: large faint text rotated 90 degrees along the page
  edge (e.g. `/ghost mint`, `/market`), as in the reference's `/about me`.
- **Layout**: clean, generous whitespace, thin divider lines between
  sections. The Spooky B-Agents structure (hero, stats row, lookup, mint,
  market, leaderboard, live activity) stays; only the styling changes.
- All imagery is new and made for Skelsol. No Framer template assets,
  code, or text are copied.

## Consequences

- The UI kit owns the palette variables, the display-type component, the
  numbered-section component, and the vertical-text treatment, so both
  apps match by construction.
- The hero images must be generated or drawn for this project (ghost /
  crypt theme, maroon glow instead of orange).
