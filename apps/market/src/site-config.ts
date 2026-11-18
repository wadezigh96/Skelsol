/**
 * Build-time site config. The committed defaults say "no override":
 * the page uses the public RPC endpoint. The build
 * (`apps/build-app.mjs`) overwrites the compiled
 * `dist/site-config.js` from environment variables when they are set
 * (Vercel: SKELSOL_DEVNET_RPC_URL), so a deployed site can use a
 * dedicated RPC endpoint without the key ever touching the repo.
 * Never put a real endpoint URL here. See ADR 0012.
 */
export const SITE_CONFIG = {
  /** Devnet RPC endpoint override, or null to use the public endpoint. */
  devnetRpcUrl: null as string | null,
};
