# Requirements

Correct the LiteSVM test count documented in the Skelsol build-and-test
steering file. The steering file is documentation, but an inaccurate test
count misleads contributors about the escrow program's test coverage.

## 1. Accurate test count

WHEN the build-and-test steering file describes the `skelsol-market`
LiteSVM tests, THE steering file SHALL state the exact number of `#[test]`
functions in `programs/skelsol-market/tests/market.rs`.

Acceptance criteria:

- WHEN a contributor counts the `#[test]` functions in
  `programs/skelsol-market/tests/market.rs`, THE count in the steering file
  SHALL match it exactly.
- WHEN the steering file summarizes the test coverage, THE summary SHALL
  account for every test in the file, including the non-NFT-mint list
  rejection, fee rounding, the zero-fee no-treasury buy, mismatched-mint
  rejection on buy and cancel, and wrong-treasury rejection, not only the
  happy paths, seller-only cancel, and rent reclaim.
- THE fix SHALL touch only `.kiro/steering/build-and-test.md`; no other
  file SHALL be modified.
