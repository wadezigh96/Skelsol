# Skelsol vocabulary and EARS requirement style

This steering file captures the shared vocabulary and the EARS requirement
format used across the Skelsol project. Source: `GLOSSARY.md`,
`requirements.md`, ADR 0002.

## Shared vocabulary

Use these terms with exactly the meanings in `GLOSSARY.md`. Every spec,
ticket, and code comment uses them consistently.

- **Skelsol**: the project. A lean template for minting inscriptions on
  Solana, plus two web apps and a CLI built from it.
- **Template**: the reusable core (inscription library, mint client,
  reader, config, wallet adapter, UI kit). An app is a template plus a
  collection config plus its own pages.
- **Inscription**: a JSON text record written on-chain via a Memo
  instruction. SPL-20-style shape:
  `{"p":"spl-20","op":"mint","tick":"<tick>","amt":"<amt>","mint":"<mint>"}`.
- **SPL-20-style**: always say "SPL-20-style", never "SPL-20" or
  "LibrePlex SPL-20". No existing SPL-20 indexer or marketplace will
  recognise memo inscriptions; the docs say so (ADR 0002).
- **Tick**: the short ticker symbol of a collection, e.g. `GHOST`.
  Valid: 1–10 chars, `[A-Z0-9]`.
- **Carrier NFT**: the Metaplex Token Metadata NFT minted together with
  an inscription. One mint produces one inscription plus one carrier NFT.
- **Mint**: the act of creating an inscription and its carrier NFT
  on-chain.
- **Collection**: one configured inscription series: tick, name, supply
  cap, per-wallet limit, price, image, network addresses.
- **Listing**: an inscription offered for sale at a fixed price, held in
  escrow until bought or cancelled.
- **Escrow**: the on-chain holding of a listed carrier NFT by the market
  program.
- **Floor price**: the lowest price among currently open listings.
- **Fee**: 1% of a sale, paid to the treasury; the seller receives 99%.
- **Devnet**: Solana's public test network. Free SOL from the faucet.
  Demo apps default to devnet.
- **Mainnet**: Solana mainnet-beta. Real SOL, real money.
- **Network switch**: the in-app control that moves between devnet and
  mainnet.
- **skel**: the CLI for AI agents. Commands: `status`, `mint`, `list`,
  `buy`, `cancel`, `lookup`.
- **Preview**: the transaction summary shown before sending anything.
  An agent must show the preview and wait for explicit confirmation.
- **agent.md**: the manual for AI agents at the repo root.

## EARS requirement style

Requirements in `requirements.md` use the EARS (Easy Approach to
Requirements Syntax) format. Follow this style when writing or editing
requirements.

### Patterns

- **Ubiquitous**: `THE <system> SHALL <action>`
  - Example: "THE CLI SHALL provide `status`, `mint`, `list`, `buy`,
    `cancel`, and `lookup` commands"
- **Event-driven**: `WHEN <condition>, THE <system> SHALL <action>`
  - Example: "WHEN a caller builds an inscription with a protocol,
    operation, ticker, and amount, THE template SHALL produce the
    canonical SPL-20 JSON"
- **Acceptance criteria** also use `WHEN … THE … SHALL …`:
  - "WHEN the ticker contains characters outside `[A-Z0-9]{1,10}`, THE
    library SHALL reject the build with a clear error"

### Rules

- Use `SHALL` for requirements, never "should" or "must".
- Start with `WHEN` for conditional behaviour; start with `THE` for
  unconditional requirements.
- Every refusal or rejection must "explain why" or carry "a clear
  error" — state this explicitly in acceptance criteria.
- Reference `GLOSSARY.md` terms by their exact names.
- Reference ADRs by number: "see ADR 0002".
