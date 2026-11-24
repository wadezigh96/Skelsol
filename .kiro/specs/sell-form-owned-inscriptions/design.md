# Design

Ownership-based inscription lookup for the Market sell form. This
design implements the requirements in `requirements.md` and follows the
reader conventions in `packages/template/src/reader.ts`.

## The problem

The Market app's `refreshSellCandidates` calls `lookupWallet`, which
runs a full Memo-program scan (`scanCollection`): it lists the last 20
Memo-program signatures, fetches each transaction, and keeps the
verified GHOST inscriptions whose holder is the given wallet. Two
proven consequences on devnet (24 Nov 2026):

1. **Scan-window aging.** `getSignaturesForAddress(MEMO_PROGRAM_ID)`
   returns only the last 20 signatures — about 7 seconds of devnet
   traffic. A judge who mints and then switches to the Market app almost
   always finds their mint aged out of the window. The sell form says
   "This wallet has minted no GHOST inscriptions yet."

2. **Mint-only attribution.** The scan attributes an inscription from
   its mint transaction: the holder is whoever received the carrier NFT
   when it was minted. A transfer (or a market buy) carries no memo, so
   it never enters a scan. A buyer can never re-list a bought NFT.

## The solution

Add `lookupOwnedInscriptions`, a reader function that finds GHOST
inscriptions by **ownership**, not by mint attribution. It goes directly
to the wallet's SPL token accounts, then verifies each candidate mint's
inscription in its mint transaction. It never scans the Memo program.

## Algorithm

```
lookupOwnedInscriptions(connection, config, wallet, options?):
  1. Normalize the wallet address (reuse normalizeWallet).
  2. List the wallet's SPL token accounts:
       connection.getTokenAccountsByOwner(wallet)
     Keep the ones with a positive balance (amount !== "0").
     Take the first 20 (DEFAULT_OWNED_LOOKUP_MINT_CAP).
  3. For each candidate mint:
     a. List its signatures (newest first):
          connection.getSignaturesForAddress(mint, { limit: 10 })
     b. If there are none, skip.
     c. The mint transaction is the OLDEST = the last in the list.
        If it is a failed transaction, skip.
     d. Check the caller's cache for that signature; if not cached,
        fetch it:
          connection.getTransaction(signature)
        and cache the result (including null for pruned).
     e. If the transaction is null (pruned) or has no meta, skip.
     f. Extract memos, parse each with parseInscription, verify the
        tick with verifyInscription, and verify the binding with
        verifyBinding (the mint must appear in postTokenBalances and
        not in preTokenBalances).
     g. If a verified GHOST inscription is found whose mint matches the
        candidate, add it to the results.
  4. Sort newest first (reuse byNewestFirst).
  5. Return WalletInscription[].
```

### Why the oldest signature is the mint transaction

`getSignaturesForAddress(mint)` returns signatures for every
transaction that touched the mint, newest first. The mint transaction
— the one that created the NFT — is the oldest. Fetching up to 10 and
taking the last gets it when the NFT has been traded fewer than 10 times.
A heavily traded NFT with more than 10 transactions has its mint
transaction beyond the fetch; the last of 10 is a recent transfer, not
the mint, so it does not verify, and the mint is skipped. This limit is
documented as a design fact (Requirement 3.2).

### Why the binding check still works for a bought NFT

The function fetches the **mint transaction** (the oldest), not the buy
transaction. The mint transaction created the NFT, so the mint appears in
its `postTokenBalances` and not in its `preTokenBalances`: the binding
check passes. The inscription's `mint` field matches the candidate. The
holder in the mint transaction is the original minter, but the function
does not check the holder — it only checks that the wallet **owns** the
token now (step 2) and that the mint transaction carries a verified
GHOST inscription (step 3f). This is what lets a buyer re-list.

## Interfaces (adapter pattern)

The new function follows the existing reader adapter pattern:
`ParsedTransactionConnection` (raw web3.js shape a real `Connection`
satisfies) → `ReaderConnection` (minimal reader shape) via
`toReaderConnection`.

### New types

```typescript
/** A token account the reader needs: mint, owner, and balance. */
interface ReaderTokenAccount {
  mint: string;
  owner: string;
  amount: string; // uiTokenAmount.amount; "0" means empty
}

/** Raw web3.js shape: ParsedTransactionConnection + parsed token accounts. */
interface ParsedTokenAccountConnection extends ParsedTransactionConnection {
  getParsedTokenAccountsByOwner(
    owner: PublicKey,
    config: { programId: PublicKey },
  ): Promise<{
    context: { slot: number };
    value: Array<{
      account: {
        data: {
          parsed: {
            info: { mint: string; owner: string; tokenAmount: { amount: string } };
          };
        };
      };
    }>;
  }>;
}

/** Minimal reader shape: ReaderConnection + token-account listing. */
interface OwnedLookupConnection extends ReaderConnection {
  getTokenAccountsByOwner(wallet: PublicKey): Promise<ReaderTokenAccount[]>;
}

/** Adapter: unwraps token accounts; reuses toReaderConnection for the rest. */
function toOwnedLookupConnection(
  connection: ParsedTokenAccountConnection,
): OwnedLookupConnection;
```

### Adapter

`toOwnedLookupConnection` reuses `toReaderConnection` for
`getSignaturesForAddress` and `getTransaction` (which bakes in
`maxSupportedTransactionVersion: 1`), and unwraps
`getParsedTokenAccountsByOwner` into the minimal `ReaderTokenAccount`
shape. The Token program ID is a constant (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`).

### Options

```typescript
interface OwnedLookupOptions extends ReaderOptions {
  mintCap?: number;            // default 20
  mintSignatureLimit?: number;  // default 10
}
```

The `cache` from `ReaderOptions` (the shared `readerCache` map) is used
to avoid refetching the same mint transaction across refreshes.

## Caps and limits (design facts)

These limits are part of the design, not footnotes. State them in code
comments wherever the relevant constant is defined.

- **20-mint cap.** At most the first 20 token accounts with a positive
  balance are checked. Each needs a signature listing and a transaction
  fetch, so the cap keeps the lookup bounded. A wallet with many NFTs
  has only its first 20 checked.
- **10-signature limit per mint.** At most 10 signatures are fetched per
  mint to find the mint transaction. A heavily traded NFT with more than
  10 transactions is skipped: its mint transaction is too old to reach.
- **Pruned mint transactions are skipped, never fatal.** A mint whose
  transaction is gone (null) is skipped silently.
- **No Memo scan.** The function does not call
  `getSignaturesForAddress(MEMO_PROGRAM_ID)`. It is independent of the
  scan window.

## What does NOT change

- `lookupWallet` is unchanged. Ghost Mint's wallet lookup and the CLI
  keep mint-attribution semantics.
- `scanCollection` and all scan-based functions
  (`getCollectionState`, `getLeaderboard`, `getActivity`,
  `getCollectionOverview`, `getMintLimits`) are unchanged.
- The escrow program, `.kiro/specs/skelsol/`, and the ADR count (15)
  are untouched. No new ADR is added.

## Testing strategy

Tests use a fake connection (`FakeOwnedLookupConnection`) implementing
`OwnedLookupConnection`, backed by the existing recorded-transaction
fixtures. No test touches the live network.

| Test | What it covers |
|---|---|
| (a) Owned GHOST carrier appears | Alice owns her mint; it is listed. |
| (b) Bought inscription appears | Carol owns MINT_ALICE_1 (bought from Alice); it is listed even though the mint transaction's holder is Alice. |
| (c) Mint aged out of scan window | The function does not query the Memo program; the mint still appears. |
| (d) Non-GHOST, zero-balance, unfetchable | A SPOOK mint is excluded; a zero-balance account is not queried; a pruned mint transaction is skipped. |
| (e) 20-mint cap | 25 token accounts; only 20 mints are queried. |
| (f) Versioned-transaction option | The adapter passes `maxSupportedTransactionVersion: 1` to `getParsedTransaction`. |

## Market app wiring

In `apps/market/src/main.ts`, `refreshSellCandidates` calls
`lookupOwnedInscriptions` through a new `ownedLookupConnection()` helper
(`toOwnedLookupConnection(adapter.getConnection())`) instead of
`lookupWallet` through `readerConnection()`. The stale comment about
mint-only attribution is replaced with ownership wording. The two
user-facing note strings change from "minted" to "owns".
