# 01: Template inscription library

**What to build:** the pure core of Skelsol: build, parse, and verify
SPL-20-style inscription JSON, including Skelsol's `mint` binding field,
with no network access at all. A developer can round-trip an inscription
(build then parse) and get the same record back; bad input is rejected
with a clear reason.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `buildInscription` produces canonical `{"p":"spl-20","op":"mint","tick":"...","amt":"...","mint":"..."}` JSON
- [ ] `parseInscription` accepts valid JSON and rejects malformed JSON without throwing uncaught
- [ ] `verifyInscription` checks the binding convention (tick matches the collection, mint field present and well-formed)
- [ ] Bad tickers (outside `[A-Z0-9]{1,10}`), non-positive amounts, and unknown operations are rejected with clear errors
- [ ] Unit tests (vitest) cover round-trip, malformed input, wrong-ticker detection, and every rejection reason
- [ ] `npm test` and typecheck pass
