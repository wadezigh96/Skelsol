# ADR 0010: Hand-built market instructions (no Anchor TypeScript client)

Status: Accepted (2026-11-19)

## Context

The escrow program is built with Anchor 1.2.2, but there is no
`@coral-xyz/anchor` 1.x TypeScript client on npm (the latest published
version is 0.32.1), and the 1.x IDL format is not what the 0.32 client
expects. The TypeScript market client still has to build `list`, `buy`,
and `cancel` transactions and read `Listing` accounts.

## Decision

Build the market instructions by hand with `@solana/web3.js`, using the
committed IDL (`programs/skelsol-market/idl/skelsol_market.json`) as the
source of truth:

- Instruction discriminators come from the IDL (8 bytes each), never
  from memory. A test asserts the client's discriminators equal the
  IDL's.
- Arguments are encoded manually: `list` takes a u64 price (little
  endian); `buy` and `cancel` take no arguments.
- `Listing` accounts are decoded manually from their Borsh layout
  (8-byte discriminator, seller, mint, price u64, bump).
- Account metas (PDAs, vault ATA, system/token programs) follow the
  IDL's account lists and the program source exactly.

## Consequences

- No Anchor TypeScript dependency at all: fewer moving parts, and the
  client works in the browser and in Node with the packages already
  installed.
- The IDL copy in the repo must be refreshed whenever the program
  changes; the market client's tests pin the discriminators, so a stale
  IDL fails loudly instead of silently.
- If Anchor ever publishes a 1.x TypeScript client, switching to it is
  a contained rewrite of one module, guarded by the same tests.
