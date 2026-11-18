# 05: Template wallet adapter

**What to build:** browser wallet connection via the Wallet Standard:
discover installed wallets (Phantom, Solflare, Backpack), connect, and
sign transactions. No seed phrases, no private keys: the wallet signs,
the app only builds unsigned transactions.

**Blocked by:** 02 (config — needs the network endpoints).

**Status:** ready-for-agent

- [ ] `discoverWallets` lists installed Wallet Standard wallets
- [ ] `connect` connects to a chosen wallet and returns the public key
- [ ] `signTransaction` signs an unsigned transaction with the connected wallet
- [ ] Connection follows the active network (devnet/mainnet) from config
- [ ] A clear error is shown when no wallet is installed
- [ ] Unit tests (vitest) with a mocked wallet cover discovery, connect, and sign
- [ ] `npm test` and typecheck pass
