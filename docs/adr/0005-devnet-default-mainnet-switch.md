# ADR 0005: Devnet by default, mainnet by switch

Status: Accepted (2026-11-19)

## Context

Minting on mainnet costs real SOL, so judges cannot try the demo without
spending money. The framework itself must support mainnet: that is the
project's point.

## Decision

- The template supports both networks through configuration (RPC endpoint,
  program IDs, collection addresses).
- Both demo apps and the CLI default to devnet. A visible network switch
  moves the app to mainnet.
- Devnet SOL is free via faucet/airdrop; the judge guide explains how to
  get it.

## Consequences

- Judges can mint, list, buy, and cancel for free on devnet.
- Mainnet behaviour is identical code, different config; the switch is the
  only difference.
