# ADR 0003: One minimal Anchor program for market escrow

Status: Accepted (2026-11-19)

## Context

A marketplace needs trustless escrow: a listed NFT must be held so the
seller cannot spend it while listed, and the buyer must receive it when
they pay. That requires an on-chain program. Everything else in Skelsol can
be done with standard programs.

## Decision

Build exactly one custom program, `skelsol-market`, in Anchor/Rust:

- `list`: move the carrier NFT into an escrow account owned by the program.
- `buy`: buyer pays the listing price in SOL; seller receives 99%; 1% goes
  to the treasury; the NFT moves to the buyer.
- `cancel`: return the NFT to the seller. Only the seller may cancel.

Deploy to devnet as part of the build. Mainnet deploy is a manual step for
the user later; the coordinator never deploys to mainnet.

## Consequences

- The program is the only custom on-chain code, so it is the only part
  needing program tests and a deploy.
- If the Anchor/Solana toolchain cannot be installed in the build
  environment, the market ships with the program code and tests but no
  devnet deploy, and the final report says so plainly. The market UI must
  never pretend to trade when no program is deployed.
