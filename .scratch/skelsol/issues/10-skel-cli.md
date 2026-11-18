# 10: skel CLI + agent.md

**What to build:** `skel`, the CLI that lets an AI agent use Skelsol
from a terminal, built on the same template library as the web apps
(no duplicated logic). Plus `agent.md` at the repo root: the manual
that tells an agent how to use it, the safety rules, and worked
examples.

**Blocked by:** 03 (mint client), 04 (reader), 08 (market client).

**Status:** ready-for-agent

- [ ] Commands: `status`, `mint`, `list`, `buy`, `cancel`, `lookup`
- [ ] Flags: `--network devnet|mainnet` (default devnet), `--json` (machine-readable output, nothing else on stdout), `--keypair <path>` for writes
- [ ] Every write prints a transaction preview and sends only after the user explicitly confirms that exact action
- [ ] Missing or malformed keypair refuses with a clear error; keypair security warnings in the help text and in `agent.md`
- [ ] `agent.md` at the repo root: commands, safety rules, worked examples (mirrors the Spooky B-Agents agent manual)
- [ ] Unit tests (vitest) cover argument parsing, `--json` output shape, and transaction building
- [ ] `npm test` and typecheck pass
