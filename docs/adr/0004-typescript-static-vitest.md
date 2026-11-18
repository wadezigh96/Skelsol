# ADR 0004: TypeScript, static sites, vitest

Status: Accepted (2026-11-19)

## Context

The demo apps must deploy to Vercel as static sites (like STIVIUM) with no
server. The template library, the CLI, and the tests share one language.

## Decision

- TypeScript everywhere (template library, apps, CLI). The apps compile
  with `tsc` to static files; Vercel runs the build at deploy time.
- No server-side code and no API routes. All chain reads go from the
  browser/CLI straight to a public Solana RPC.
- Tests with vitest. Unit tests for the inscription library, transaction
  building, argument parsing, and the reader; Anchor tests for the escrow
  program; devnet integration tests where possible.

## Consequences

- `npm test` runs the whole unit suite; a failing test blocks a ticket
  from being called done.
- The static output must work from any static host, not only Vercel.
