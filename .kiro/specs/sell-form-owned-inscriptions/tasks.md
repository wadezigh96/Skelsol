# Tasks

Implementation plan for ownership-based inscription lookup. All work is
TDD: one red-green slice at a time.

- [x] 1. Reader interfaces and adapter
  - [x] 1.1 Add `ReaderTokenAccount`, `ParsedTokenAccountConnection`,
        `OwnedLookupConnection`, and `toOwnedLookupConnection` to
        `reader.ts` (extend the existing adapter pattern; reuse
        `toReaderConnection` for signatures and transactions; unwrap
        `getParsedTokenAccountsByOwner` to the minimal shape).
  - [x] 1.2 Add the `TOKEN_PROGRAM_ID` constant.
  - [x] 1.3 Add `DEFAULT_OWNED_LOOKUP_MINT_CAP` (20) and
        `DEFAULT_MINT_SIGNATURE_FETCH` (10) constants with design-fact
        comments.
  - [x] 1.4 Add `OwnedLookupOptions` interface (extends `ReaderOptions`
        with `mintCap` and `mintSignatureLimit`).
  - [x] 1.5 Type-check: a real `Connection` satisfies
        `ParsedTokenAccountConnection`.

- [x] 2. `lookupOwnedInscriptions` function
  - [x] 2.1 Implement the algorithm: list token accounts, filter
        positive balance, cap at 20, find mint transaction (oldest of
        up to 10 signatures), fetch, verify with `parseInscription` /
        `verifyInscription` / `verifyBinding`, cache by signature.
  - [x] 2.2 Reuse `normalizeWallet`, `extractMemos`, `verifyBinding`,
        and `byNewestFirst`.
  - [x] 2.3 Reject a malformed wallet with `ReaderError`
        (`invalid-wallet`).
  - [x] 2.4 Skip pruned (null) and failed mint transactions, never
        fatal.
  - [x] 2.5 Return `WalletInscription[]` newest first.

- [x] 3. Tests for `lookupOwnedInscriptions`
  - [x] 3.1 Add `FakeOwnedLookupConnection` (implements
        `OwnedLookupConnection`).
  - [x] 3.2 (a) An owned GHOST carrier appears.
  - [x] 3.3 (b) A bought inscription appears even though the mint
        transaction's holder is a different wallet.
  - [x] 3.4 (c) A mint aged out of the scan window still appears; the
        Memo program is never queried.
  - [x] 3.5 (d) Non-GHOST mints, zero-balance token accounts, and
        unfetchable mint transactions are excluded or skipped, never
        fatal.
  - [x] 3.6 (e) The 20-mint cap is honored (25 accounts, 20 queried).
  - [x] 3.7 (f) `maxSupportedTransactionVersion: 1` is passed to
        `getParsedTransaction` for the mint-transaction fetch (through
        the adapter).
  - [x] 3.8 Invalid wallet address is rejected.
  - [x] 3.9 The caller's cache is used: a second lookup with a shared
        cache does not refetch the same mint transaction.

- [x] 4. Wire the Market app
  - [x] 4.1 Import `lookupOwnedInscriptions` and
        `toOwnedLookupConnection` in `apps/market/src/main.ts`; remove
        the now-unused `lookupWallet` import.
  - [x] 4.2 Add an `ownedLookupConnection()` helper.
  - [x] 4.3 Change `refreshSellCandidates` to call
        `lookupOwnedInscriptions` through the new helper; update the
        stale comment.
  - [x] 4.4 Update the two user-facing note strings: "minted" → "owns".

- [x] 5. Verify
  - [x] 5.1 `npm run build` (dist/ must exist before tests resolve).
  - [x] 5.2 `npm test` (full suite, zero failures).
  - [x] 5.3 `npm run typecheck` (zero errors).
