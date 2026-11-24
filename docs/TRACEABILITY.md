# Traceability: requirement → task → module → test

Every row maps a requirement in `.kiro/specs/skelsol/requirements.md`
to the task that built it (`.kiro/specs/skelsol/tasks.md`), the module
that implements it, and the test that covers it. Only mappings that
exist in the repo are listed; rows with no automated test say so
instead of inventing one.

| Requirement | Task | Module | Test |
|---|---|---|---|
| 1.1 Build a valid inscription | 1 (1.1, 1.2) | `packages/template/src/inscription.ts` | `inscription.test.ts` — `buildInscription` |
| 1.2 Parse and verify an inscription | 1 (1.1, 1.3) | `packages/template/src/inscription.ts` | `inscription.test.ts` — `parseInscription`, `verifyInscription` |
| 2.1 Mint an inscription | 3 (3.1, 3.2) | `packages/template/src/mint.ts`, `limits.ts` | `mint.test.ts`, `limits.test.ts` |
| 2.2 Show the cost before sending | 3 (3.3) | `packages/template/src/mint.ts` | `mint.test.ts` — cost breakdown |
| 3.1 Rebuild collection state from the chain | 4 (4.1–4.3) | `packages/template/src/reader.ts` | `reader.test.ts` — `getCollectionState` |
| 3.2 Leaderboard and activity | 4 (4.3) | `packages/template/src/reader.ts` | `reader.test.ts` — `getLeaderboard`, `getActivity` |
| 4.1 One config per collection | 2 (2.1, 2.3) | `packages/template/src/config.ts` | `config.test.ts` — `loadCollectionConfig`, `GHOST_COLLECTION` |
| 5.1 Devnet default, mainnet by switch | 2 (2.2), 5 (5.2), 6 (6.3) | `packages/template/src/config.ts`, `wallet.ts`; network switch in both apps | `config.test.ts` — `getNetworkConfig`, `DEFAULT_NETWORK`; `wallet.test.ts` |
| 6.1 Ghost Mint page | 6 (6.1, 6.2) | `apps/ghost-mint/src/main.ts`, `view.ts` | `apps/ghost-mint/src/view.test.ts` |
| 6.2 Ghost Mint leaderboard and activity | 6 (6.1, 6.2) | `apps/ghost-mint/src/main.ts` + `packages/template/src/reader.ts` | `apps/ghost-mint/src/view.test.ts`, `reader.test.ts` |
| 7.1 Listings | 7 (7.1), 8 (8.1, 8.2), 9 (9.1) | `programs/skelsol-market/src/` (`list`), `packages/template/src/market.ts`, `apps/market/src/` | `programs/skelsol-market/tests/market.rs` (`list_*`), `market.test.ts`, `apps/market/src/view.test.ts` |
| 7.2 Buy and cancel | 7 (7.1, 7.2), 8, 9 | `programs/skelsol-market/src/` (`buy`, `cancel`), `packages/template/src/market.ts` | `programs/skelsol-market/tests/market.rs` (`buy_*`, `cancel_*`), `market.test.ts` |
| 8.1 CLI commands | 10 (10.1, 10.2) | `cli/src/commands.ts`, `args.ts` | `cli/src/commands.test.ts`, `args.test.ts` |
| 8.2 CLI wallet and safety | 10 (10.2) | `cli/src/keypair.ts`, `confirm.ts`, `commands.ts` | `cli/src/keypair.test.ts`, `confirm.test.ts`, `commands.test.ts` |
| 8.3 `agent.md` manual | 10 (10.3) | `agent.md` (repo root) | No automated test (a doc; verified by reading) |
| 9.1 Kiro spec directory | — (the spec itself) | `.kiro/specs/skelsol/` | No automated test |
| 9.2 Submission draft | 11 (11.2) | `docs/SUBMISSION.md` | No automated test. The requirement's TODO wording is historical: the video link and the "How Kiro was used" section are both done. |
| 10.1 Tests pass | 11 (11.4) | Whole repo | `npm test` (vitest, offline) + `cargo test` (11 LiteSVM tests in `programs/skelsol-market/tests/market.rs`) |
| 10.2 No real funds in tests | — (design.md, Testing strategy) | Test suites use recorded fixtures + in-process LiteSVM; no test touches mainnet | Same suites as 10.1; no separate test |

Notes:

- Task 7's subtasks (7.1–7.3) are checked and the program is deployed
  on devnet (19 Nov 2026); the parent task-7 checkbox is still
  unticked, reserved for a real Kiro session.
- `transfer` and `list` inscription operations are not implemented
  (requirement 1.1 accepts `mint` only), so they have no row here.
