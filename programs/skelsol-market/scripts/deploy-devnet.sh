#!/usr/bin/env bash
# Deploy skelsol-market to DEVNET. Never mainnet: the cluster URL is
# hard-coded to devnet below, and the script refuses to run if the Solana
# CLI config points anywhere else.
#
# Prerequisites:
#   - Program keypair at ~/.config/solana/skelsol-market.json (the program
#     ID is derived from it; never copy it into the repo).
#   - Deploy wallet at ~/.config/solana/id.json, funded with devnet SOL.
#     The wallet needs ~3 SOL (program rent for a ~200 KB binary plus
#     fees). Get it from the web faucet: https://faucet.solana.com
#     (the CLI airdrop against the public RPC is closed). The deploy
#     wallet address is 7T1fjFsHvo3Q7EpwN5RzgNk8HARdxKnC3tgkavAbBQX7.
#   - The treasury address in src/constants.rs must already hold SOL
#     (it is the deployer's wallet for devnet).
#
# Usage: ./programs/skelsol-market/scripts/deploy-devnet.sh
# Run from the repo root. After a devnet reset, re-run this script to
# redeploy (same program ID: the keypair is stable).
set -euo pipefail

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
export TMPDIR="$HOME/.cargo-tmp"

DEVNET_URL="https://api.devnet.solana.com"
PROGRAM_KEYPAIR="$HOME/.config/solana/skelsol-market.json"
WALLET="$HOME/.config/solana/id.json"
PROGRAM_ID="3XMFqwbEND9gYWoTahNQPhVoNspHet1PfdizsRymqwNo"
MIN_BALANCE_LAMPORTS=2000000000  # 2 SOL floor; deploy needs ~1.5-3 SOL

cd "$(dirname "$0")/../../.."

# Guard: refuse if the CLI config points at mainnet (or anything not devnet).
CONFIG_URL="$(solana config get | awk '/RPC URL:/ {print $3}')"
if [ "$CONFIG_URL" != "$DEVNET_URL" ]; then
  echo "Refusing: solana config RPC URL is '$CONFIG_URL', expected devnet."
  echo "Run: solana config set --url $DEVNET_URL --keypair $WALLET"
  exit 1
fi

[ -f "$PROGRAM_KEYPAIR" ] || { echo "Missing program keypair: $PROGRAM_KEYPAIR"; exit 1; }
[ -f "$WALLET" ] || { echo "Missing deploy wallet: $WALLET"; exit 1; }

# Guard: the keypair must match the program ID in the source.
KEYPAIR_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
if [ "$KEYPAIR_ID" != "$PROGRAM_ID" ]; then
  echo "Refusing: program keypair is $KEYPAIR_ID, source declares $PROGRAM_ID."
  exit 1
fi

BALANCE="$(solana balance --url "$DEVNET_URL" --keypair "$WALLET" --lamports | tr -dc '0-9')"
if ! [[ "$BALANCE" =~ ^[0-9]+$ ]]; then
  echo "Refusing: could not read the deploy wallet balance."
  exit 1
fi
echo "Deploy wallet balance: $BALANCE lamports"
if [ "$BALANCE" -lt "$MIN_BALANCE_LAMPORTS" ]; then
  echo "Refusing: need at least $MIN_BALANCE_LAMPORTS lamports to deploy."
  echo "Fund $(solana-keygen pubkey "$WALLET") at https://faucet.solana.com, then re-run."
  exit 1
fi

echo "Building..."
anchor build

echo "Deploying $PROGRAM_ID to devnet..."
solana program deploy \
  --url "$DEVNET_URL" \
  --keypair "$WALLET" \
  --program-id "$PROGRAM_KEYPAIR" \
  target/deploy/skelsol_market.so

echo "Verifying..."
solana program show --url "$DEVNET_URL" "$PROGRAM_ID"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
