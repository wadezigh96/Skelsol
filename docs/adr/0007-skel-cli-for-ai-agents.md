# ADR 0007: skel CLI for AI agents

Status: Accepted (2026-11-19)

## Context

Spooky B-Agents is played by AI agents through the `baw` CLI plus an
`agent.md` manual. Skelsol should offer the same: an AI agent drives
Skelsol from a terminal, using the same template library as the web apps.

## Decision

- Ship a `skel` command (Node.js binary, TypeScript) built on the template
  library. No duplicated mint/market logic.
- Commands: `status`, `mint`, `list`, `buy`, `cancel`, `lookup`.
- Flags: `--network devnet|mainnet` (default devnet), `--json` for
  machine-readable output.
- The agent wallet is a local keypair file (`--keypair <path>`). The docs
  and the CLI itself warn: never commit a keypair, never use a keypair
  holding large funds.
- Safety rule, documented in `agent.md` and enforced by the CLI: every
  write shows a transaction preview first; the transaction is sent only
  after the user explicitly confirms that exact action.
- Ship `agent.md` at the repo root: the AI-agent manual (how to use `skel`,
  safety rules, worked examples), mirroring Spooky B-Agents' `agent.md`.

## Consequences

- The template library must be usable from Node.js with no browser APIs.
- `agent.md` is part of the submission story: judges can see exactly how an
  agent is meant to use Skelsol.
