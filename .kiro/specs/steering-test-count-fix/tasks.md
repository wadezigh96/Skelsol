# Tasks

Fix the LiteSVM test count in the build-and-test steering file.

- [x] 1. Correct the LiteSVM test count in `.kiro/steering/build-and-test.md`
  - Count the `#[test]` functions in `programs/skelsol-market/tests/market.rs` (11, not 8)
  - Replace "8 tests" with "11 tests" and expand the coverage summary to name every test
  - Touch only `.kiro/steering/build-and-test.md`; modify no other file
