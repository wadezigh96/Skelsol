# ADR 0012: Dedicated devnet RPC via a build-time environment variable

Status: Accepted (2026-11-19)

## Context

After the ADR 0011 speed fix, the live-browser re-check showed the
pages loading in seconds, but the public devnet RPC
(`api.devnet.solana.com`) was still rate-limiting the test browser:
12-20 of 20 records failed to read per refresh, with HTTP 429s. The
public endpoint is shared by every developer on devnet, so its
throttling is outside our control. A dedicated RPC endpoint (Helius
free tier: 1M credits/month, no card) gives the demo sites their own
quota. The endpoint URL carries the provider's API key as a query
parameter, so it must never be committed to this public repo, and
the apps are static sites with no bundler and no server to read
environment variables at runtime.

## Decision

- The template exposes `setRpcEndpointOverride(network, url)` and
  `clearRpcEndpointOverrides()` in `config.ts`. `getNetworkConfig`
  applies the override (returning a copy, so the shared defaults are
  never mutated). An override must be an http(s) URL; anything else
  throws a `ConfigError` at startup instead of failing mid-scan.
- The web apps read the override from a build-time config file.
  Each app keeps a committed `src/site-config.ts` whose defaults say
  "no override" (`devnetRpcUrl: null`); `apps/build-app.mjs`
  overwrites the compiled `dist/site-config.js` from the
  `SKELSOL_DEVNET_RPC_URL` environment variable when it is set
  (Vercel dashboard, both projects), and `main.ts` applies it before
  the first on-chain read. Without the variable, the sites fall back
  to the public endpoint, unchanged.
- The CLI reads `SKELSOL_DEVNET_RPC_URL` and
  `SKELSOL_MAINNET_RPC_URL` from its own environment at startup and
  applies them the same way. A bad URL fails with a one-line error
  (the override runs inside the `try` that reports CLI errors), not
  a stack trace.
- The key is visible in the deployed site's JavaScript: any RPC URL
  a browser page uses is public by nature. That is accepted for a
  free-tier demo key, which can be rotated if it is abused. Hiding
  the key would need a server-side proxy, which the static sites do
  not have.

## Consequences

- The demo sites' rate-limit budget is the key's, not the shared
  public pool's. A judge's single visit is far below the free
  tier's limits.
- No environment variable means no behavior change: local builds
  and the CLI keep using the public endpoint.
- Rotating the key is a Vercel dashboard edit plus a redeploy; no
  code or repo change is needed.
