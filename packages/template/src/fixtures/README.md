# Fixtures

Hand-written recorded-transaction fixtures for the template reader tests.
These are **test data, not real chain data**: the signatures, addresses,
slots, and block times were invented for the tests (addresses are
deterministic keypairs derived from fixture labels, so they are valid
base58 Solana addresses). No fixture corresponds to a real transaction.

Each file is shaped like one `getTransaction` (`jsonParsed`) response,
with a top-level `signature` field added so the test fake can key
transactions by signature. The test loader strips the `signature` and
`_note` fields before handing the transaction to the reader.

| File | What it covers |
|---|---|
| `mint-alice-1.json` | Valid GHOST mint by alice (oldest valid mint) |
| `mint-bob-1.json` | Valid GHOST mint by bob |
| `mint-alice-2.json` | Valid GHOST mint by alice (newest valid mint) |
| `malformed-memo.json` | Memo log line that is not valid JSON |
| `wrong-tick-memo.json` | Valid inscription JSON, but tick `SPOOK`, not `GHOST` |
| `no-memo.json` | Plain SOL transfer, no memo at all |
| `unverified-mint.json` | Valid GHOST memo, but the mint is not in the transaction's token balances |
| `failed-mint.json` | Valid GHOST memo in a transaction that failed (`meta.err` set) |
| `transfer-alice-1-to-carol.json` | Alice sends her first inscription to carol: no memo, so the reader ignores it |

Across all eight fixtures the GHOST collection has: 3 minted, 2 holders
(alice 2, bob 1), 1 malformed memo, 1 unverified inscription. The
transfer fixture is not part of that count: it is only used by the
`getMintLimits` test that proves the limit counts mints, not current
holdings.
