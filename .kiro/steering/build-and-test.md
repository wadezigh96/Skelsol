# Skelsol build and test commands

This steering file captures the build, test, and typecheck commands used
in the Skelsol project. Source: `package.json`, `Anchor.toml`, ADR 0004,
`docs/DEPLOY.md`, `design.md` (Testing strategy), `requirements.md` §10.

## TypeScript / Node.js (the primary toolchain)

The project uses TypeScript everywhere: the template library, the web
apps, and the CLI. No server-side code, no API routes. Apps compile
with `tsc` to static files (ADR 0004).

### Commands (from the repo root)

```sh
npm install              # install workspace dependencies
npm test                 # full unit suite (vitest, offline)
npm run typecheck        # tsc --build across the workspace
npm run build            # typecheck + build the CLI binary
```

### What each command does

- `npm test` runs `vitest run --workspace=vitest.workspace.ts`. Unit
  tests for the inscription library, transaction building, argument
  parsing, and the reader. Fixtures are recorded transactions (checked
  in), not live RPC calls, so `npm test` is fast and offline.
- `npm run typecheck` runs `tsc --build packages/template
  apps/ghost-mint apps/market cli`.
- `npm run build` runs the typecheck, then `chmod +x cli/dist/cli.js`.

### Per-app and per-package builds

Each app builds to a static site in its own `dist/` directory:

```sh
cd apps/ghost-mint && npm run build    # tsc + build.mjs
cd apps/market && npm run build        # tsc + build.mjs
cd cli && npm run build                # tsc to dist/
```

### Watch mode (not for CI)

```sh
npm run test:watch    # vitest --workspace=vitest.workspace.ts
```

Do not use watch mode in the agent or in hooks. Use `npm test` (the
`run` form) for single-execution tests.

## Anchor / Rust (the escrow program)

The one custom on-chain program is `skelsol-market` (Anchor, Rust). Tests
are Rust + LiteSVM — the anchor-cli 1.2.2 default. There is no
`@coral-xyz/anchor` 1.x TypeScript client on npm (latest is 0.32.1), so
there are no TypeScript Anchor tests.

```sh
anchor test    # builds the program, then runs cargo test in-process
```

`Anchor.toml` sets `skip_local_validator = true` and
`[scripts] test = "cargo test"`. The LiteSVM tests run entirely
in-process; no local validator is needed. 11 tests, covering list/buy/
cancel happy paths, non-NFT-mint list rejection, fee rounding and
zero-fee (no-treasury) buys, mismatched-mint rejection on buy and
cancel, wrong-price (insufficient-funds) rejection, wrong-treasury
rejection, seller-only cancel, and rent reclaim on close.

## Quality gates (requirements §10)

- WHEN `npm test` runs, THE unit suite SHALL pass with no failures.
- WHEN the escrow program changes, THE Anchor tests SHALL pass.
- WHEN any test runs, THE system SHALL NOT send a transaction to mainnet
  or spend real funds.

Devnet integration tests (mint, list, buy, cancel against the deployed
program) run separately, marked so `npm test` stays offline.

## Toolchain notes

- Node.js 18+ and npm are required for the TypeScript side.
- The Anchor program needs the Rust / Solana toolchain (see
  `docs/DEPLOY.md` for gotchas: rustc stable, anchor-cli 1.2.2,
  solana-cli 4.1.2, platform-tools v1.57).
- Do not `cargo update` blindly: the lockfile is pinned to a specific
  solana 4.1.x-era graph. See `docs/DEPLOY.md` for the full list of
  toolchain gotchas.
