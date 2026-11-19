# ADR 0014: Import Buffer from "buffer" (the market read never failed on RPC)

Status: Accepted (2026-11-19)

## Context

ADR 0013 assumed the market read failed on the RPC: it retried, fell
back to the public endpoint, and surfaced the raw error cause. The
surfaced cause proved the assumption wrong. The live-browser check
after the ADR 0013 deploy showed the market note reading "Could not
reach the market right now. (Buffer is not defined)" on both sites —
a JavaScript error, not a network failure. The retry and the fallback
could not help: every attempt threw the same error before any network
call was made.

The cause: `market.ts` used the Node.js `Buffer` global
(`Buffer.from` for the listing memcmp filter and the instruction
discriminators, `Buffer.alloc` for the list instruction). Browsers
have no `Buffer` global, so `getListings` threw a `ReferenceError`
before calling `getProgramAccounts`. That is why the market read
failed on every load (4 of 4) while the transaction fetches mostly
worked, why the timeout message never appeared, and why `skel
status` (Node, where `Buffer` exists) always reported the market
as live. The list/buy/cancel builders used the same global, so
listing and buying would have failed in the browser too; minting
never used `Buffer` and was unaffected.

The bug was invisible to all 355 unit tests because vitest runs in
Node, where the global exists. Deleting the global inside a test to
simulate a browser does not work either: vitest's own worker IPC
uses the global `Buffer` and hangs.

## Decision

- `market.ts` imports `Buffer` explicitly: `import { Buffer } from
  "buffer"`. Node resolves it natively (builtin); the apps' import
  maps point "buffer" at the esm.sh browser build
  (`https://esm.sh/buffer@6.0.3`), the same version already in the
  lockfile as a transitive dependency of web3.js. `buffer@6.0.3` is
  now a direct dependency of the template package.
- A regression test (`browser-globals.test.ts`) scans the browser
  sources (template + both apps, test files excluded) and fails
  when a file uses the `Buffer` value without importing it from
  "buffer", or uses any other Node-only global (`process`,
  `__dirname`, `__filename`, `require`). Type-only uses are fine
  (erased at compile time). The CLI is excluded: it runs in Node.

## Consequences

- The market read, listing, buying, and cancelling now work in the
  browser. The ADR 0013 retry, fallback, and cause display stay in
  place: they are genuine robustness, and the cause display is what
  found this bug.
- Any future bare Node global in browser code fails the test suite
  instead of failing silently on the live sites.
